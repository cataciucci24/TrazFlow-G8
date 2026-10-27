-- TRZ-100 (segunda parte): confirm_dispatch_order no confirma una orden del ERP cuyo armado no coincide con lo
-- pedido (20261028100400_trz100_dispatch_quantity_match.sql).
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
--
-- Cubre: falta, sobra, producto no pedido, coincidencia exacta en kilogramos (sin tolerancia), varias líneas del
-- mismo producto, pallets no esperados que no cuentan, que el rechazo no cambia nada, el orden de los chequeos
-- (missing_pallets primero), corregir y confirmar con outbox, orden del ERP sin líneas y orden manual.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-100 cantidades: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'trz100qm-warehouse@test.local'),
  ('c1000000-0000-0000-0000-000000000002', 'trz100qm-manager@test.local');
insert into companies (id, name) values ('c2000000-0000-0000-0000-000000000001', 'TRZ100 QM Company');
insert into users (id, company_id, name, email, role) values
  ('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'Depósito', 'trz100qm-warehouse@test.local', 'warehouse_operator'),
  ('c1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'Logística', 'trz100qm-manager@test.local', 'logistics_manager');
insert into distributors (id, company_id, name, external_id, source_system) values
  ('c3000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'Cliente', 'CUST-QM', 'erp');

insert into products (id, company_id, sku, name, unit_of_measure, external_uom, external_id, source_system, external_active) values
  ('c4000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'ARZ', 'Arroz', 'cajas', 'Caja', 'ARZ', 'erp', true),
  ('c4000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'FID', 'Fideos', 'cajas', 'Caja', 'FID', 'erp', true),
  ('c4000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001', 'QSO', 'Queso', 'kilogramos', 'Kg', 'QSO', 'erp', true);
insert into products (id, company_id, sku, name, unit_of_measure) values
  ('c4000000-0000-0000-0000-000000000009', 'c2000000-0000-0000-0000-000000000001', 'MAN', 'Manual', 'unidades');
insert into batches (id, product_id, batch_number, quantity, external_id, source_system, external_active) values
  ('c5000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'L-ARZ', 0, 'L-ARZ', 'erp', true),
  ('c5000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000002', 'L-FID', 0, 'L-FID', 'erp', true),
  ('c5000000-0000-0000-0000-000000000003', 'c4000000-0000-0000-0000-000000000003', 'L-QSO', 0, 'L-QSO', 'erp', true);
insert into batches (id, product_id, batch_number, quantity) values
  ('c5000000-0000-0000-0000-000000000009', 'c4000000-0000-0000-0000-000000000009', 'L-MAN', 10);

insert into erp_warehouse_mappings (company_id, external_warehouse_id, created_by) values
  ('c2000000-0000-0000-0000-000000000001', 'Central', 'c1000000-0000-0000-0000-000000000002');
insert into erp_stock_balances (company_id, batch_id, external_warehouse_id, warehouse_code, quantity) values
  ('c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 1000),
  ('c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'Central', 'DEP-01', 1000),
  ('c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003', 'Central', 'DEP-01', 1000);

-- Órdenes. 1..7 del ERP; 8 manual.
--   1 falta          pide Arroz 100              armado Arroz 60
--   2 sobra          pide Arroz 50               armado Arroz 60
--   3 no pedido      pide Arroz 40               armado Arroz 40 + Fideos 10
--   4 coincide       pide Arroz 30 + 20, Queso 12,35   armado Arroz 50, Queso 12,35 (+ Fideos 99 no esperado)
--   5 kg exacto      pide Queso 10               armado Queso 10,01
--   6 sin validar    pide Arroz 100              armado Arroz 60, sin validar
--   7 sin líneas     (importada antes de TRZ-100)  armado Arroz 5
--   8 manual         armado Manual 3
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, external_id, source_system)
select ('c7000000-0000-0000-0000-00000000000' || n)::uuid, 'c2000000-0000-0000-0000-000000000001',
       'c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'draft', current_date, 'SO-QM-' || n, 'erp'
from generate_series(1, 7) n;
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date) values
  ('c7000000-0000-0000-0000-000000000008', 'c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'draft', current_date);

insert into dispatch_order_lines (company_id, order_id, external_id, product_id, quantity, external_uom) values
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001', 'L1', 'c4000000-0000-0000-0000-000000000001', 100, 'Caja'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002', 'L1', 'c4000000-0000-0000-0000-000000000001', 50, 'Caja'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000003', 'L1', 'c4000000-0000-0000-0000-000000000001', 40, 'Caja'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000004', 'L1', 'c4000000-0000-0000-0000-000000000001', 30, 'Caja'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000004', 'L2', 'c4000000-0000-0000-0000-000000000001', 20, 'Caja'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000004', 'L3', 'c4000000-0000-0000-0000-000000000003', 12.35, 'Kg'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000005', 'L1', 'c4000000-0000-0000-0000-000000000003', 10, 'Kg'),
  ('c2000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000006', 'L1', 'c4000000-0000-0000-0000-000000000001', 100, 'Caja');

insert into pallets (id, company_id, batch_id, qr_code, status, quantity) values
  ('c6000000-0000-0000-0000-000000000011', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-11', 'assigned', 60),
  ('c6000000-0000-0000-0000-000000000021', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-21', 'assigned', 60),
  ('c6000000-0000-0000-0000-000000000031', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-31', 'assigned', 40),
  ('c6000000-0000-0000-0000-000000000032', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'PAL-QM-32', 'assigned', 10),
  ('c6000000-0000-0000-0000-000000000041', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-41', 'assigned', 50),
  ('c6000000-0000-0000-0000-000000000042', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003', 'PAL-QM-42', 'assigned', 12.35),
  ('c6000000-0000-0000-0000-000000000043', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'PAL-QM-43', 'in_warehouse', 99),
  ('c6000000-0000-0000-0000-000000000051', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003', 'PAL-QM-51', 'assigned', 10.01),
  ('c6000000-0000-0000-0000-000000000061', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-61', 'assigned', 60),
  ('c6000000-0000-0000-0000-000000000071', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-71', 'assigned', 5),
  ('c6000000-0000-0000-0000-000000000081', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000009', 'PAL-QM-81', 'assigned', 3);

insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by)
select ('c7000000-0000-0000-0000-00000000000' || substr(p, 1, 1))::uuid, ('c6000000-0000-0000-0000-0000000000' || p)::uuid,
       true, true, now(), 'c1000000-0000-0000-0000-000000000001'
from unnest(array['11', '21', '31', '32', '41', '42', '51', '71', '81']) p;
-- Orden 6: el pallet todavía no se validó.
insert into order_pallets (order_id, pallet_id, expected) values
  ('c7000000-0000-0000-0000-000000000006', 'c6000000-0000-0000-0000-000000000061', true);
-- Orden 4: un pallet que apareció al validar sin estar en la orden (expected = false) no cuenta como armado.
insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by) values
  ('c7000000-0000-0000-0000-000000000004', 'c6000000-0000-0000-0000-000000000043', false, true, now(), 'c1000000-0000-0000-0000-000000000001');

/* ---------- Rechazos ---------- */

set local role authenticated;
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
do $$
declare result record;
begin
  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'quantity_mismatch', 'falta: ' || result.outcome);
  perform pg_temp.assert_true(result.order_id = 'c7000000-0000-0000-0000-000000000001' and result.status = 'draft'
    and result.confirmed_at is null and result.pallet_count is null, 'falta: forma de la fila');

  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true(result.outcome = 'quantity_mismatch', 'sobra: ' || result.outcome);

  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000003');
  perform pg_temp.assert_true(result.outcome = 'quantity_mismatch', 'producto no pedido: ' || result.outcome);

  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000005');
  perform pg_temp.assert_true(result.outcome = 'quantity_mismatch', 'kg sin tolerancia (10,01 vs 10): ' || result.outcome);

  -- Primero se exige validar todos los pallets; recién después se comparan cantidades.
  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000006');
  perform pg_temp.assert_true(result.outcome = 'missing_pallets' and result.pallet_count = 1, 'sin validar: ' || result.outcome);
end;
$$;
reset role;

-- Un rechazo por cantidades no cambia nada.
select pg_temp.assert_true(
  (select bool_and(status = 'draft' and confirmed_at is null) from dispatch_orders
   where id in ('c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002',
                'c7000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-000000000005')),
  'las órdenes rechazadas quedan en borrador');
select pg_temp.assert_true(
  (select bool_and(status = 'assigned') from pallets
   where id in ('c6000000-0000-0000-0000-000000000011', 'c6000000-0000-0000-0000-000000000021',
                'c6000000-0000-0000-0000-000000000031', 'c6000000-0000-0000-0000-000000000032',
                'c6000000-0000-0000-0000-000000000051')),
  'los pallets de las órdenes rechazadas siguen asignados');
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_events where company_id = 'c2000000-0000-0000-0000-000000000001'),
  'un rechazo no escribe el outbox');
select pg_temp.assert_true(
  not exists (select 1 from traceability_events where order_id in (
    'c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002',
    'c7000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-000000000005') and event_type = 'dispatch_confirmed'),
  'un rechazo no registra el despacho');

/* ---------- Confirmaciones ---------- */

-- Orden 1 corregida: se suma un pallet de 40 y coincide (60 + 40 = 100).
insert into pallets (id, company_id, batch_id, qr_code, status, quantity) values
  ('c6000000-0000-0000-0000-000000000012', 'c2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'PAL-QM-12', 'assigned', 40);
insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by) values
  ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000012', true, true, now(), 'c1000000-0000-0000-0000-000000000001');

set local role authenticated;
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
do $$
declare result record;
begin
  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000004');
  perform pg_temp.assert_true(result.outcome = 'confirmed' and result.pallet_count = 2,
    'coincide (dos líneas del mismo producto, kg exacto, no esperado ignorado): ' || result.outcome);

  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'confirmed' and result.pallet_count = 2, 'falta corregida: ' || result.outcome);

  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000007');
  perform pg_temp.assert_true(result.outcome = 'confirmed', 'orden del ERP sin líneas confirma como antes: ' || result.outcome);

  select * into result from public.confirm_dispatch_order('c7000000-0000-0000-0000-000000000008');
  perform pg_temp.assert_true(result.outcome = 'confirmed', 'orden manual confirma como antes: ' || result.outcome);
end;
$$;
reset role;

select pg_temp.assert_true(
  (select count(*) = 3 from erp_outbox_events where aggregate_id in (
    'c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000004', 'c7000000-0000-0000-0000-000000000007')),
  'las órdenes del ERP confirmadas generan su reporte');
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_events where aggregate_id = 'c7000000-0000-0000-0000-000000000008'),
  'la orden manual no genera reporte');
select pg_temp.assert_true(
  (select jsonb_array_length(payload->'lines') = 2 and payload->>'idempotencyKey' = 'dispatch:SO-QM-4'
   from erp_outbox_events where aggregate_id = 'c7000000-0000-0000-0000-000000000004'),
  'el reporte de la orden 4 lleva solo los pallets esperados');
select pg_temp.assert_true(
  (select bool_and(status = 'in_transit') from pallets
   where id in ('c6000000-0000-0000-0000-000000000011', 'c6000000-0000-0000-0000-000000000012',
                'c6000000-0000-0000-0000-000000000041', 'c6000000-0000-0000-0000-000000000042',
                'c6000000-0000-0000-0000-000000000071', 'c6000000-0000-0000-0000-000000000081')),
  'los pallets confirmados salen a tránsito');

rollback;
