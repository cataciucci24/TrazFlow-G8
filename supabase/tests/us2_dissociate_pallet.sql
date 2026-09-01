-- Prueba de integración de la extensión de US2 (desasociar pallet). Ejecutar
-- sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us2_dissociate_pallet.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US2-dissociate test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'manager@test.local'),
  ('10000000-0000-0000-0000-000000000002', 'warehouse@test.local'),
  ('10000000-0000-0000-0000-000000000003', 'distributor-op@test.local'),
  ('10000000-0000-0000-0000-000000000004', 'other-manager@test.local');

insert into companies (id, name)
values
  ('20000000-0000-0000-0000-000000000001', 'Company A'),
  ('20000000-0000-0000-0000-000000000002', 'Company B');

insert into users (id, company_id, name, email, role)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Manager', 'manager@test.local', 'logistics_manager'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Warehouse', 'warehouse@test.local', 'warehouse_operator'),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Distributor Op', 'distributor-op@test.local', 'distributor_operator'),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'Other Manager', 'other-manager@test.local', 'logistics_manager');

insert into distributors (id, company_id, name)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Distributor');

insert into products (id, company_id, sku, name)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'SKU-1', 'Product');

insert into batches (id, product_id, batch_number, quantity)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LOT-1', 10);

-- 60...01: pallet a desasociar en la orden 1 (sin validar).
-- 60...02: pallet ya validado en la orden 2 (no debe poder sacarse).
-- 60...03: pallet en la orden 3, que ya está 'confirmed' (no debe poder sacarse).
insert into pallets (id, company_id, batch_id, qr_code, status)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-1', 'assigned'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-2', 'assigned'),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PAL-3', 'in_transit');

insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date)
values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draft', current_date),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draft', current_date),
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'confirmed', current_date);

insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by)
values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', true, false, null, null),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', true, true, now(), '10000000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', true, true, now(), '10000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

-- --- camino feliz: desasocia un pallet sin validar de una orden draft ------
do $$
declare result record;
begin
  select * into result from dissociate_pallet_from_order(
    '70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'
  );
  perform pg_temp.assert_true(result.outcome = 'dissociated', 'logistics_manager debe poder desasociar un pallet sin validar');
end;
$$;

select pg_temp.assert_true(
  not exists (
    select 1 from order_pallets
    where order_id = '70000000-0000-0000-0000-000000000001'
      and pallet_id = '60000000-0000-0000-0000-000000000001'
  ),
  'la fila de order_pallets debe borrarse'
);

select pg_temp.assert_true(
  (select status from pallets where id = '60000000-0000-0000-0000-000000000001') = 'in_warehouse',
  'el pallet debe volver a in_warehouse'
);

-- --- pallet ya validado: no se puede sacar ----------------------------------
do $$
declare result record;
begin
  select * into result from dissociate_pallet_from_order(
    '70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'
  );
  perform pg_temp.assert_true(result.outcome = 'not_removable', 'un pallet ya validado no debe poder desasociarse');
end;
$$;

select pg_temp.assert_true(
  exists (
    select 1 from order_pallets
    where order_id = '70000000-0000-0000-0000-000000000002'
      and pallet_id = '60000000-0000-0000-0000-000000000002'
  ),
  'la fila de order_pallets no debe tocarse si estaba validado'
);

select pg_temp.assert_true(
  (select status from pallets where id = '60000000-0000-0000-0000-000000000002') = 'assigned',
  'el status del pallet validado no debe cambiar'
);

-- --- orden que ya no está en draft ------------------------------------------
select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003'
  )) = 'not_removable',
  'no se puede desasociar en una orden que no está en draft'
);

-- --- roles sin permiso --------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'
  )) = 'forbidden',
  'warehouse_operator no debe poder desasociar pallets'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'
  )) = 'forbidden',
  'distributor_operator no debe poder desasociar pallets'
);

-- --- aislamiento entre empresas ----------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'
  )) = 'order_not_found',
  'un logistics_manager de otra compañía no debe acceder a la orden'
);

reset role;
rollback;
