-- Prueba de integración de US3. Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us3_pallet_validation.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US3 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'warehouse@test.local'),
  ('10000000-0000-0000-0000-000000000002', 'manager@test.local'),
  ('10000000-0000-0000-0000-000000000003', 'other-warehouse@test.local');

insert into companies (id, name)
values
  ('20000000-0000-0000-0000-000000000001', 'Company A'),
  ('20000000-0000-0000-0000-000000000002', 'Company B');

insert into users (id, company_id, name, email, role)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Warehouse', 'warehouse@test.local', 'warehouse_operator'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Manager', 'manager@test.local', 'logistics_manager'),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Other Warehouse', 'other-warehouse@test.local', 'warehouse_operator');

insert into distributors (id, company_id, name)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Distributor');

insert into products (id, company_id, sku, name)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'SKU-1', 'Product');

insert into batches (id, product_id, batch_number, quantity)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LOT-1', 10);

insert into pallets (id, company_id, batch_id, qr_code, status)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-VALID', 'assigned'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-WRONG-ORDER', 'assigned');

insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date)
values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'draft', current_date),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'draft', current_date);

insert into order_pallets (order_id, pallet_id)
values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

do $$
declare result record;
begin
  select * into result from validate_order_pallet(
    '70000000-0000-0000-0000-000000000001', 'PAL-VALID'
  );
  perform pg_temp.assert_true(result.outcome = 'validated', 'warehouse_operator debe validar el pallet correcto');
end;
$$;

select pg_temp.assert_true(
  exists (
    select 1 from order_pallets
    where order_id = '70000000-0000-0000-0000-000000000001'
      and pallet_id = '60000000-0000-0000-0000-000000000001'
      and detected_at_dispatch
      and validated_at is not null
      and validated_by = '10000000-0000-0000-0000-000000000001'
  ),
  'validated_at, validated_by y detected_at_dispatch deben persistirse'
);

select pg_temp.assert_true(
  (select count(*) from traceability_events
   where order_id = '70000000-0000-0000-0000-000000000001'
     and pallet_id = '60000000-0000-0000-0000-000000000001'
     and event_type = 'qr_scan') = 1,
  'la validación debe crear exactamente un evento qr_scan'
);

do $$
declare result record;
begin
  select * into result from validate_order_pallet(
    '70000000-0000-0000-0000-000000000001', 'PAL-VALID'
  );
  perform pg_temp.assert_true(result.outcome = 'already_validated', 'el duplicado debe rechazarse');

  select * into result from validate_order_pallet(
    '70000000-0000-0000-0000-000000000001', 'PAL-WRONG-ORDER'
  );
  perform pg_temp.assert_true(result.outcome = 'wrong_order', 'un pallet de otra orden debe rechazarse');

  select * into result from validate_order_pallet(
    '70000000-0000-0000-0000-000000000001', 'PAL-NOT-FOUND'
  );
  perform pg_temp.assert_true(result.outcome = 'pallet_not_found', 'un QR inexistente debe informarse');
end;
$$;

select pg_temp.assert_true(
  (select count(*) from traceability_events
   where order_id = '70000000-0000-0000-0000-000000000001'
     and pallet_id = '60000000-0000-0000-0000-000000000001'
     and event_type = 'qr_scan') = 1,
  'el intento duplicado no debe crear otro evento'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select outcome from validate_order_pallet('70000000-0000-0000-0000-000000000001', 'PAL-VALID')) = 'forbidden',
  'otro rol no debe validar pallets'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select outcome from validate_order_pallet('70000000-0000-0000-0000-000000000001', 'PAL-VALID')) = 'order_not_found',
  'un usuario de otra compañía no debe acceder a la orden'
);

reset role;
rollback;
