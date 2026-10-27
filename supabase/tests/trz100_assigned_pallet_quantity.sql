-- TRZ-100 (segunda parte): cantidad de un pallet asociado a una orden en borrador
-- (20261028100500_trz100_assigned_pallet_quantity.sql) y nuevo escaneo después de borrar la validación
-- (20261028100600_trz100_revalidate_after_quantity_edit.sql).
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
--
-- Cubre: permisos (rol y empresa), pallet en depósito / despachado / heredado del ERP, cantidad inválida para la
-- unidad, sin cambios (no borra la validación), edición sin validar, edición validada (borra la validación y se
-- puede volver a escanear con ronda 2, una sola vez), tope por saldo del ERP, que solo cambia la cantidad, y el
-- flujo completo: falta → corregir el pallet → volver a escanear → confirmar.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-100 pallet asociado: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'trz100aq-warehouse@test.local'),
  ('d1000000-0000-0000-0000-000000000002', 'trz100aq-manager@test.local'),
  ('d1000000-0000-0000-0000-000000000003', 'trz100aq-manager-b@test.local');
insert into companies (id, name) values
  ('d2000000-0000-0000-0000-000000000001', 'TRZ100 AQ Company'),
  ('d2000000-0000-0000-0000-000000000002', 'TRZ100 AQ Company B');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'Depósito', 'trz100aq-warehouse@test.local', 'warehouse_operator'),
  ('d1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'Logística', 'trz100aq-manager@test.local', 'logistics_manager'),
  ('d1000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000002', 'Logística B', 'trz100aq-manager-b@test.local', 'logistics_manager');
insert into distributors (id, company_id, name, external_id, source_system) values
  ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'Cliente', 'CUST-AQ', 'erp');

insert into products (id, company_id, sku, name, unit_of_measure, external_uom, external_id, source_system, external_active) values
  ('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'QSO', 'Queso', 'kilogramos', 'Kg', 'QSO', 'erp', true),
  ('d4000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'ARZ', 'Arroz', 'cajas', 'Caja', 'ARZ', 'erp', true);
insert into batches (id, product_id, batch_number, quantity, external_id, source_system, external_active) values
  ('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'L-QSO', 0, 'L-QSO', 'erp', true),
  ('d5000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002', 'L-ARZ', 0, 'L-ARZ', 'erp', true);
insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values
  ('d2000000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 'd1000000-0000-0000-0000-000000000002');
-- Queso: saldo 100 kg. Arroz: saldo 50 cajas.
insert into erp_stock_balances (company_id, batch_id, external_warehouse_id, warehouse_code, quantity) values
  ('d2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 100),
  ('d2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002', 'Central', 'DEP-01', 50);

-- Orden 1 (del ERP): pide 48,25 kg de queso; armado 46 kg, ya validado por depósito.
-- Orden 2 (del ERP): pide 10 cajas de arroz; armado 8, sin validar.
-- Orden 3: ya confirmada (su pallet está en tránsito).
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, external_id, source_system) values
  ('d7000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'draft', current_date, 'SO-AQ-1', 'erp'),
  ('d7000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'draft', current_date, 'SO-AQ-2', 'erp');
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at) values
  ('d7000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'confirmed', current_date, now());
insert into dispatch_order_lines (company_id, order_id, external_id, product_id, quantity, external_uom) values
  ('d2000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'L1', 'd4000000-0000-0000-0000-000000000001', 48.25, 'Kg'),
  ('d2000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000002', 'L1', 'd4000000-0000-0000-0000-000000000002', 10, 'Caja');

insert into pallets (id, company_id, batch_id, qr_code, status, quantity) values
  ('d6000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'PAL-AQ-1', 'assigned', 46),
  ('d6000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002', 'PAL-AQ-2', 'assigned', 8),
  ('d6000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002', 'PAL-AQ-3', 'in_warehouse', 5),
  ('d6000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002', 'PAL-AQ-4', 'in_transit', 3);
-- Heredado de un saldo del ERP (antes de TRZ-100), asignado a la orden 2.
insert into pallets (id, company_id, batch_id, qr_code, status, quantity, external_id, source_system, synced_at) values
  ('d6000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002', 'PAL-AQ-5', 'assigned', 2, 'ERP-AQ-5', 'erp', now());

insert into order_pallets (order_id, pallet_id, expected) values
  ('d7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', true),
  ('d7000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002', true),
  ('d7000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000005', true),
  ('d7000000-0000-0000-0000-000000000003', 'd6000000-0000-0000-0000-000000000004', true);

/* ---------- Depósito valida el pallet de la orden 1 (como en la app) ---------- */

set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select outcome = 'validated' from public.validate_order_pallet('d7000000-0000-0000-0000-000000000001', 'PAL-AQ-1')),
  'primer escaneo');
select pg_temp.assert_true(
  (select outcome = 'quantity_mismatch' from public.confirm_dispatch_order('d7000000-0000-0000-0000-000000000001')),
  'con 46 de 48,25 kg no se confirma');
reset role;

/* ---------- Rechazos ---------- */

set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select outcome = 'forbidden' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000001', 48.25)),
  'depósito no edita');
select pg_temp.as_user('d1000000-0000-0000-0000-000000000003');
select pg_temp.assert_true(
  (select outcome = 'pallet_not_found' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000001', 48.25)),
  'logística de otra empresa no lo ve');
select pg_temp.as_user('d1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select outcome = 'not_assigned' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000003', 6)),
  'en depósito se edita por el camino de siempre');
select pg_temp.assert_true(
  (select outcome = 'not_assigned' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000004', 4)),
  'despachado no se edita');
select pg_temp.assert_true(
  (select outcome = 'not_editable' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000005', 3)),
  'heredado del ERP no se edita');
select pg_temp.assert_true(
  (select outcome = 'invalid_quantity' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000002', 9.5)),
  'cajas no admite decimales');
select pg_temp.assert_true(
  (select outcome = 'invalid_quantity' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000002', 0)),
  'cero no');
select pg_temp.assert_true(
  (select outcome = 'invalid_quantity' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000001', 48.255)),
  'kg con tres decimales no');
select pg_temp.assert_true(
  (select outcome = 'unchanged' and not validation_cleared from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000001', 46)),
  'la misma cantidad no cambia nada');
reset role;

select pg_temp.assert_true(
  (select validated_at is not null from order_pallets where pallet_id = 'd6000000-0000-0000-0000-000000000001'),
  'guardar sin cambios no borra la validación');
select pg_temp.assert_true(
  (select quantity = 2 from pallets where id = 'd6000000-0000-0000-0000-000000000005')
  and (select quantity = 8 from pallets where id = 'd6000000-0000-0000-0000-000000000002')
  and (select quantity = 3 from pallets where id = 'd6000000-0000-0000-0000-000000000004'),
  'los rechazos no cambian cantidades');

-- Tope por saldo: arroz tiene 50 cajas; hay 8 + 5 + 2 armadas (las 3 despachadas son de una orden manual y no
-- cuentan). Pasar el pallet de 8 a 44 daría 51.
set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000002');
do $$
begin
  perform * from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000002', 44);
  raise exception 'TRZ-100 pallet asociado: el tope no frenó la edición';
exception when sqlstate 'TF100' then
  null;
end;
$$;
reset role;
select pg_temp.assert_true(
  (select quantity = 8 from pallets where id = 'd6000000-0000-0000-0000-000000000002'),
  'superar el saldo no cambia la cantidad');

/* ---------- Ediciones ---------- */

set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select outcome = 'updated' and not validation_cleared and order_id = 'd7000000-0000-0000-0000-000000000002'
   from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000002', 10)),
  'sin validar: actualiza sin tocar validaciones');
select pg_temp.assert_true(
  (select outcome = 'updated' and validation_cleared and qr_code = 'PAL-AQ-1'
   from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000001', 48.25)),
  'validado: actualiza y borra la validación');
reset role;

select pg_temp.assert_true(
  (select quantity = 48.25 and batch_id = 'd5000000-0000-0000-0000-000000000001' and status = 'assigned'
   from pallets where id = 'd6000000-0000-0000-0000-000000000001'),
  'solo cambia la cantidad');
select pg_temp.assert_true(
  (select validated_at is null and validated_by is null and not detected_at_dispatch and expected
   from order_pallets where pallet_id = 'd6000000-0000-0000-0000-000000000001'),
  'la validación quedó borrada y el pallet sigue en la orden');
select pg_temp.assert_true(
  (select count(*) = 1 from traceability_events
   where pallet_id = 'd6000000-0000-0000-0000-000000000001' and event_type = 'qr_scan'),
  'el escaneo anterior queda en el historial');

/* ---------- Volver a escanear y confirmar ---------- */

set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select outcome = 'missing_pallets' from public.confirm_dispatch_order('d7000000-0000-0000-0000-000000000001')),
  'sin volver a escanear no se confirma');
select pg_temp.assert_true(
  (select outcome = 'validated' from public.validate_order_pallet('d7000000-0000-0000-0000-000000000001', 'PAL-AQ-1')),
  'se puede volver a escanear');
select pg_temp.assert_true(
  (select outcome = 'already_validated' from public.validate_order_pallet('d7000000-0000-0000-0000-000000000001', 'PAL-AQ-1')),
  'el mismo escaneo no se registra dos veces');
select pg_temp.assert_true(
  (select outcome = 'confirmed' from public.confirm_dispatch_order('d7000000-0000-0000-0000-000000000001')),
  'con 48,25 kg coincide y se confirma');
reset role;

select pg_temp.assert_true(
  (select array_agg(coalesce(details->>'validation_round', '1') order by created_at, details->>'validation_round') = array['1', '2']
   from traceability_events where pallet_id = 'd6000000-0000-0000-0000-000000000001' and event_type = 'qr_scan'),
  'dos escaneos, rondas 1 y 2');
select pg_temp.assert_true(
  (select (payload->'lines'->0->>'quantity')::numeric = 48.25 from erp_outbox_events
   where aggregate_id = 'd7000000-0000-0000-0000-000000000001'),
  'el reporte al ERP lleva la cantidad corregida');

-- El índice sigue impidiendo dos qr_scan de la misma ronda.
do $$
begin
  insert into traceability_events (company_id, pallet_id, order_id, event_type, user_id, details)
  values ('d2000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001',
          'qr_scan', 'd1000000-0000-0000-0000-000000000001', '{"qr_code": "PAL-AQ-1", "validation_round": 2}');
  raise exception 'TRZ-100 pallet asociado: se aceptó un segundo qr_scan de la misma ronda';
exception when unique_violation then
  null;
end;
$$;

-- Ya despachado, no se edita más.
set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select outcome = 'not_assigned' from public.update_assigned_pallet_quantity('d6000000-0000-0000-0000-000000000001', 50)),
  'después de confirmar no se edita');
reset role;

rollback;
