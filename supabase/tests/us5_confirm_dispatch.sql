-- Prueba de integración de US5. Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us5_confirm_dispatch.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US5 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'warehouse@test.local'),
  ('10000000-0000-0000-0000-000000000002', 'manager@test.local'),
  ('10000000-0000-0000-0000-000000000003', 'other-warehouse@test.local'),
  ('10000000-0000-0000-0000-000000000004', 'distributor-op@test.local');

insert into companies (id, name)
values
  ('20000000-0000-0000-0000-000000000001', 'Company A'),
  ('20000000-0000-0000-0000-000000000002', 'Company B');

insert into users (id, company_id, name, email, role)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Warehouse', 'warehouse@test.local', 'warehouse_operator'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Manager', 'manager@test.local', 'logistics_manager'),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Other Warehouse', 'other-warehouse@test.local', 'warehouse_operator'),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'Distributor Op', 'distributor-op@test.local', 'distributor_operator');

insert into distributors (id, company_id, name)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Distributor');

insert into products (id, company_id, sku, name)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'SKU-1', 'Product');

insert into batches (id, product_id, batch_number, quantity)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LOT-1', 10);

-- Pallets de la orden 1 (camino feliz: se confirman los dos).
insert into pallets (id, company_id, batch_id, qr_code, status)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-OK-1', 'assigned'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-OK-2', 'assigned');

-- Pallets de la orden 2 (uno validado, uno pendiente -> missing_pallets).
insert into pallets (id, company_id, batch_id, qr_code, status)
values
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-MISS-1', 'assigned'),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-MISS-2', 'assigned');

insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date)
values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'draft', current_date),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'draft', current_date),
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'draft', current_date);

insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by)
values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', true, true, now(), '10000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', true, true, now(), '10000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003', true, true, now(), '10000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000004', true, false, null, null);
-- Orden 3 (70...03) queda sin pallets asociados -> no_pallets.

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

-- --- camino feliz: confirma la orden 1 -------------------------------------
do $$
declare result record;
begin
  select * into result from confirm_dispatch_order('70000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'confirmed', 'warehouse_operator debe poder confirmar una orden con todos los pallets validados');
  perform pg_temp.assert_true(result.pallet_count = 2, 'debe informar la cantidad de pallets confirmados');
  perform pg_temp.assert_true(result.confirmed_at is not null, 'debe devolver confirmed_at');
end;
$$;

select pg_temp.assert_true(
  (select status = 'confirmed' and confirmed_at is not null
   from dispatch_orders where id = '70000000-0000-0000-0000-000000000001'),
  'la orden debe quedar en status confirmed con confirmed_at seteado'
);

select pg_temp.assert_true(
  (select count(*) from pallets
   where id in ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002')
     and status = 'in_transit'
     and current_location = 'En tránsito') = 2,
  'los pallets confirmados deben pasar a in_transit con la ubicación actualizada'
);

select pg_temp.assert_true(
  (select count(*) from traceability_events
   where order_id = '70000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_confirmed') = 1,
  'la confirmación debe crear exactamente un evento dispatch_confirmed'
);

-- --- reintento sobre una orden ya confirmada --------------------------------
do $$
declare
  result record;
  v_confirmed_at_before timestamptz;
begin
  select confirmed_at into v_confirmed_at_before
  from dispatch_orders where id = '70000000-0000-0000-0000-000000000001';

  select * into result from confirm_dispatch_order('70000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'invalid_status', 'no se puede reconfirmar una orden ya confirmada');

  perform pg_temp.assert_true(
    (select confirmed_at = v_confirmed_at_before
     from dispatch_orders where id = '70000000-0000-0000-0000-000000000001'),
    'un reintento no debe pisar confirmed_at'
  );
end;
$$;

select pg_temp.assert_true(
  (select count(*) from traceability_events
   where order_id = '70000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_confirmed') = 1,
  'el reintento no debe duplicar el evento dispatch_confirmed'
);

-- --- pallets faltantes -------------------------------------------------------
do $$
declare result record;
begin
  select * into result from confirm_dispatch_order('70000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true(result.outcome = 'missing_pallets', 'no se puede confirmar mientras haya pallets esperados sin validar');
  perform pg_temp.assert_true(result.pallet_count = 1, 'debe informar cuántos pallets faltan validar');
end;
$$;

select pg_temp.assert_true(
  (select status from dispatch_orders where id = '70000000-0000-0000-0000-000000000002') = 'draft',
  'la orden con pallets faltantes no debe cambiar de status'
);

-- --- orden sin pallets asociados --------------------------------------------
select pg_temp.assert_true(
  (select outcome from confirm_dispatch_order('70000000-0000-0000-0000-000000000003')) = 'no_pallets',
  'no se puede confirmar una orden sin pallets asociados'
);

-- --- roles sin permiso --------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select outcome from confirm_dispatch_order('70000000-0000-0000-0000-000000000002')) = 'forbidden',
  'logistics_manager no debe poder confirmar despachos'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  (select outcome from confirm_dispatch_order('70000000-0000-0000-0000-000000000002')) = 'forbidden',
  'distributor_operator no debe poder confirmar despachos'
);

-- --- aislamiento entre empresas ----------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select outcome from confirm_dispatch_order('70000000-0000-0000-0000-000000000002')) = 'order_not_found',
  'un warehouse_operator de otra compañía no debe acceder a la orden'
);

reset role;
rollback;
