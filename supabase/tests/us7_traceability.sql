-- Prueba de integración de US7. Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us7_traceability.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US7 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('12000000-0000-0000-0000-000000000001', 'manager-us7@test.local'),
  ('12000000-0000-0000-0000-000000000002', 'manager-other-us7@test.local');

insert into companies (id, name)
values
  ('22000000-0000-0000-0000-000000000001', 'US7 Company A'),
  ('22000000-0000-0000-0000-000000000002', 'US7 Company B');

insert into users (id, company_id, name, email, role)
values
  ('12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Manager US7', 'manager-us7@test.local', 'logistics_manager'),
  ('12000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'Other Manager US7', 'manager-other-us7@test.local', 'logistics_manager');

insert into distributors (id, company_id, name)
values
  ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Distribuidor US7 A'),
  ('32000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'Distribuidor US7 B');

insert into products (id, company_id, sku, name)
values
  ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'SKU-US7-A', 'Producto US7 A'),
  ('42000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'SKU-US7-B', 'Producto US7 B');

insert into batches (id, product_id, batch_number, quantity)
values
  ('52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', 'LOT-US7-A', 10),
  ('52000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002', 'LOT-US7-B', 10);

insert into pallets (id, company_id, batch_id, qr_code, status, current_location)
values
  ('62000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 'PAL-US7-TRACE', 'received', 'Distribuidor US7 A'),
  ('62000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 'PAL-US7-NO-MOVEMENTS', 'in_warehouse', 'Depósito Central'),
  ('62000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000002', 'PAL-US7-OTHER-COMPANY', 'in_warehouse', 'Depósito Ajeno');

insert into dispatch_orders (
  id, company_id, distributor_id, created_by, status, estimated_dispatch_date
)
values (
  '72000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'confirmed',
  '2026-09-02'
);

-- Se insertan fuera de orden cronológico para verificar el ORDER BY de US7.
insert into movements (
  id, pallet_id, order_id, origin_location, destination_location,
  resulting_status, user_id, created_at
)
values
  (
    '82000000-0000-0000-0000-000000000002',
    '62000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000001',
    'En tránsito',
    'Distribuidor US7 A',
    'received',
    '12000000-0000-0000-0000-000000000001',
    '2026-09-02 14:45:00+00'
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '62000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000001',
    'Depósito Central',
    'En tránsito',
    'in_transit',
    '12000000-0000-0000-0000-000000000001',
    '2026-09-02 10:20:00+00'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);

-- Pallet propio y datos descriptivos/actuales visibles.
select pg_temp.assert_true(
  (
    select pallet.qr_code = 'PAL-US7-TRACE'
      and pallet.status = 'received'
      and pallet.current_location = 'Distribuidor US7 A'
      and product.name = 'Producto US7 A'
      and product.sku = 'SKU-US7-A'
      and batch.batch_number = 'LOT-US7-A'
    from pallets pallet
    join batches batch on batch.id = pallet.batch_id
    join products product on product.id = batch.product_id
    where pallet.qr_code = 'PAL-US7-TRACE'
      and pallet.company_id = auth_company_id()
  ),
  'debe devolver pallet, producto, lote, estado y ubicación de la empresa autenticada'
);

-- Todos los movimientos se leen del más antiguo al más reciente.
select pg_temp.assert_true(
  (
    select array_agg(destination_location order by created_at asc, id asc)
      = array['En tránsito', 'Distribuidor US7 A']::text[]
    from movements
    where pallet_id = '62000000-0000-0000-0000-000000000001'
  ),
  'debe devolver todos los movements en orden cronológico ascendente'
);

-- Un pallet existente sin movements sigue siendo visible.
select pg_temp.assert_true(
  exists (
    select 1 from pallets
    where qr_code = 'PAL-US7-NO-MOVEMENTS'
      and company_id = auth_company_id()
  )
  and not exists (
    select 1 from movements
    where pallet_id = '62000000-0000-0000-0000-000000000002'
  ),
  'un pallet sin movements debe seguir siendo consultable'
);

-- Un QR inexistente devuelve cero filas.
select pg_temp.assert_true(
  not exists (
    select 1 from pallets
    where qr_code = 'PAL-US7-NOT-FOUND'
      and company_id = auth_company_id()
  ),
  'un QR inexistente no debe devolver pallets'
);

-- RLS oculta pallets de otras empresas aunque se conozca el QR.
select pg_temp.assert_true(
  not exists (
    select 1 from pallets
    where qr_code = 'PAL-US7-OTHER-COMPANY'
  ),
  'un logistics_manager no debe ver pallets de otra empresa'
);

-- Las mismas consultas de US7 no alteran ninguna tabla ni el estado del pallet.
select pg_temp.assert_true(
  (select count(*) from movements where pallet_id = '62000000-0000-0000-0000-000000000001') = 2
  and (
    select status = 'received' and current_location = 'Distribuidor US7 A'
    from pallets
    where id = '62000000-0000-0000-0000-000000000001'
  ),
  'las consultas de trazabilidad no deben modificar datos'
);

reset role;
rollback;
