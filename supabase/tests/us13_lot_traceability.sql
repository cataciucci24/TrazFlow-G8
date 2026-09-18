-- Prueba de integración de US13 (TRZ-13). Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us13_lot_traceability.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US13 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('13000000-0000-0000-0000-000000000001', 'manager-us13@test.local'),
  ('13000000-0000-0000-0000-000000000002', 'operator-us13@test.local'),
  ('13000000-0000-0000-0000-000000000003', 'manager-other-us13@test.local');

insert into companies (id, name)
values
  ('23000000-0000-0000-0000-000000000001', 'US13 Company A'),
  ('23000000-0000-0000-0000-000000000002', 'US13 Company B');

insert into users (id, company_id, name, email, role)
values
  ('13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Manager US13', 'manager-us13@test.local', 'logistics_manager'),
  ('13000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', 'Operator US13', 'operator-us13@test.local', 'warehouse_operator'),
  ('13000000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000002', 'Other Manager US13', 'manager-other-us13@test.local', 'logistics_manager');

insert into products (id, company_id, sku, name)
values
  ('43000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'SKU-US13-A', 'Producto US13 A'),
  ('43000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000002', 'SKU-US13-B', 'Producto US13 B (otra empresa)');

insert into batches (id, product_id, batch_number, expiration_date, quantity)
values
  ('53000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', 'LOT-US13-SHARED', '2026-12-31', 100),
  ('53000000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000002', 'LOT-US13-SHARED', '2026-11-30', 50);

-- Dos pallets del mismo lote (uno con movements, otro sin) + un pallet de otra
-- empresa con el mismo batch_number, para probar que no se mezclan.
insert into pallets (id, company_id, batch_id, qr_code, status, current_location, quantity, unit_of_measure)
values
  ('63000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'PAL-US13-A1', 'in_transit', 'En tránsito', 10, 'cajas'),
  ('63000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'PAL-US13-A2', 'in_warehouse', 'Depósito Central', 5, 'cajas'),
  ('63000000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000002', 'PAL-US13-B1', 'in_warehouse', 'Depósito Ajeno', 20, 'unidades');

-- Fuera de orden cronológico, para verificar el ORDER BY del RPC.
insert into movements (id, pallet_id, order_id, origin_location, destination_location, resulting_status, user_id, created_at)
values
  ('83000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000001', null, 'Depósito Central', 'En tránsito', 'in_transit', '13000000-0000-0000-0000-000000000001', '2026-09-10 14:00:00+00'),
  ('83000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', null, null, 'Depósito Central', 'in_warehouse', '13000000-0000-0000-0000-000000000001', '2026-09-01 09:00:00+00');

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);

-- Devuelve ambos pallets del lote propio, con sus movements en orden cronológico.
select pg_temp.assert_true(
  (
    select array_agg(pallet_qr_code order by pallet_qr_code)
    from get_lot_traceability('LOT-US13-SHARED')
    where pallet_qr_code is not null
      and batch_id = '53000000-0000-0000-0000-000000000001'
  ) = array['PAL-US13-A1', 'PAL-US13-A1', 'PAL-US13-A2']::text[],
  'debe devolver todas las filas (pallet x movement) de los pallets del lote propio'
);

select pg_temp.assert_true(
  (
    select array_agg(movement_destination_location order by movement_created_at)
    from get_lot_traceability('LOT-US13-SHARED')
    where pallet_qr_code = 'PAL-US13-A1'
  ) = array['Depósito Central', 'En tránsito']::text[],
  'los movements de un pallet deben venir en orden cronológico ascendente'
);

-- El pallet sin movements sigue apareciendo, con movement_id null.
select pg_temp.assert_true(
  exists (
    select 1 from get_lot_traceability('LOT-US13-SHARED')
    where pallet_qr_code = 'PAL-US13-A2' and movement_id is null
  ),
  'un pallet del lote sin movements debe seguir siendo visible'
);

-- No mezcla el lote de otra empresa aunque comparta batch_number.
select pg_temp.assert_true(
  not exists (
    select 1 from get_lot_traceability('LOT-US13-SHARED')
    where pallet_qr_code = 'PAL-US13-B1'
  ),
  'un logistics_manager no debe ver pallets de otra empresa aunque el lote tenga el mismo número'
);

-- Un batch_number inexistente no devuelve filas.
select pg_temp.assert_true(
  not exists (select 1 from get_lot_traceability('LOT-US13-NOT-FOUND')),
  'un lote inexistente no debe devolver filas'
);

reset role;

-- Un rol sin permiso (warehouse_operator) no puede consultar trazabilidad de lote.
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);

select pg_temp.assert_true(
  not exists (select 1 from get_lot_traceability('LOT-US13-SHARED')),
  'un warehouse_operator no debe poder consultar trazabilidad de lote'
);

reset role;

-- Un logistics_manager de otra empresa no ve el lote ajeno.
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000003', true);

select pg_temp.assert_true(
  (
    select array_agg(distinct pallet_qr_code)
    from get_lot_traceability('LOT-US13-SHARED')
    where pallet_qr_code is not null
  ) = array['PAL-US13-B1']::text[],
  'un logistics_manager de otra empresa solo debe ver su propio lote con el mismo número'
);

reset role;
rollback;
