-- US-ERP-04: reporte del despacho confirmado al ERP mediante outbox.
-- Ejecutar con psql -v ON_ERROR_STOP=1 -f supabase/tests/us_erp04_dispatch_outbox.sql sobre una base local
-- migrada. Todo se revierte al final.
--
-- Cubre: atomicidad de la confirmación con el outbox, payload, confirmación doble, órdenes manuales,
-- timeout y reintento con backoff, lease vencido, error permanente, reintentos agotados, reintento manual,
-- inmutabilidad del payload y de la clave, unicidad de la clave y RLS por empresa y rol (depósito).
-- Dentro de una transacción now() no avanza: el "paso del tiempo" se simula moviendo next_attempt_at y
-- locked_until como superusuario.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'US-ERP-04: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

-- Usuarios
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'erp04-warehouse-a@test.local'),
  ('f1000000-0000-0000-0000-000000000002', 'erp04-manager-a@test.local'),
  ('f1000000-0000-0000-0000-000000000003', 'erp04-driver-a@test.local'),
  ('f1000000-0000-0000-0000-000000000004', 'erp04-warehouse-b@test.local'),
  ('f1000000-0000-0000-0000-000000000005', 'erp04-manager-b@test.local');
insert into companies (id, name) values
  ('f2000000-0000-0000-0000-000000000001', 'ERP04 Company A'),
  ('f2000000-0000-0000-0000-000000000002', 'ERP04 Company B');
insert into users (id, company_id, name, email, role) values
  ('f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'Operador Depósito A', 'erp04-warehouse-a@test.local', 'warehouse_operator'),
  ('f1000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'Logística A', 'erp04-manager-a@test.local', 'logistics_manager'),
  ('f1000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'Chofer A', 'erp04-driver-a@test.local', 'driver_operator'),
  ('f1000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000002', 'Operador Depósito B', 'erp04-warehouse-b@test.local', 'warehouse_operator'),
  ('f1000000-0000-0000-0000-000000000005', 'f2000000-0000-0000-0000-000000000002', 'Logística B', 'erp04-manager-b@test.local', 'logistics_manager');

insert into distributors (id, company_id, name, external_id, source_system) values
  ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'Distribuidora Norte', 'CUST-N', 'erp'),
  ('f3000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002', 'Cliente B', 'CUST-B', 'erp');

-- Maestros importados del ERP (como los deja US-ERP-03). El queso se sincronizó antes de external_uom.
insert into products (id, company_id, sku, name, unit_of_measure, external_uom, external_id, source_system, external_active) values
  ('f4000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'ACE-500', 'Aceite', 'cajas', 'Caja', 'ACE-500', 'erp', true),
  ('f4000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'QSO', 'Queso', 'kilogramos', null, 'QSO', 'erp', true),
  ('f4000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000002', 'ACE-500', 'Aceite', 'cajas', 'Caja', 'ACE-500', 'erp', true);
insert into products (id, company_id, sku, name, unit_of_measure) values
  ('f4000000-0000-0000-0000-000000000009', 'f2000000-0000-0000-0000-000000000001', 'MANUAL', 'Producto manual', 'unidades');
insert into batches (id, product_id, batch_number, quantity, external_id, source_system, external_active) values
  ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'L-2026-0915', 0, 'L-2026-0915', 'erp', true),
  ('f5000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000002', 'Q-1', 0, 'Q-1', 'erp', true),
  ('f5000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000003', 'L-B', 0, 'L-B', 'erp', true);
insert into batches (id, product_id, batch_number, quantity) values
  ('f5000000-0000-0000-0000-000000000009', 'f4000000-0000-0000-0000-000000000009', 'MAN-1', 10);

-- TRZ-100: los pallets de lotes del ERP se arman contra el saldo del ERP (tope por saldo).
insert into erp_warehouse_mappings (company_id, external_warehouse_id, created_by) values
  ('f2000000-0000-0000-0000-000000000001', 'Central', 'f1000000-0000-0000-0000-000000000002'),
  ('f2000000-0000-0000-0000-000000000002', 'Central', 'f1000000-0000-0000-0000-000000000005');
insert into erp_stock_balances (company_id, batch_id, external_warehouse_id, warehouse_code, quantity) values
  ('f2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 120),
  ('f2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000002', 'Central', 'DEP-01', 356.5),
  ('f2000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000003', 'Central', 'DEP-01', 7);

insert into pallets (id, company_id, batch_id, qr_code, status, quantity) values
  -- Orden SO-1: dos pallets de dos lotes.
  ('f6000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'PAL-ERP04-B', 'assigned', 45),
  ('f6000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000002', 'PAL-ERP04-A', 'assigned', 20.5),
  -- Orden SO-2 (atomicidad y error permanente).
  ('f6000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'PAL-ERP04-C', 'assigned', 10),
  -- Orden manual.
  ('f6000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000009', 'PAL-ERP04-M', 'assigned', 3),
  -- Orden de la empresa B.
  ('f6000000-0000-0000-0000-000000000005', 'f2000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000003', 'PAL-ERP04-X', 'assigned', 7);

insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, external_id, source_system) values
  ('f7000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'draft', current_date, 'SO-1', 'erp'),
  ('f7000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'draft', current_date, 'SO-2', 'erp'),
  ('f7000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000005', 'draft', current_date, 'SO-B', 'erp');
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date) values
  ('f7000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'draft', current_date);

-- TRZ-100: líneas de SO-1 (como las deja la sincronización). Aceite en una sola línea; queso en dos.
insert into dispatch_order_lines (company_id, order_id, external_id, product_id, quantity, external_uom) values
  ('f2000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'SO-1-1', 'f4000000-0000-0000-0000-000000000001', 45, 'Caja'),
  ('f2000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'SO-1-2', 'f4000000-0000-0000-0000-000000000002', 10, 'Kg'),
  ('f2000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'SO-1-3', 'f4000000-0000-0000-0000-000000000002', 10.5, 'Kg');

insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by) values
  ('f7000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', true, true, now(), 'f1000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000002', true, true, now(), 'f1000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000002', 'f6000000-0000-0000-0000-000000000003', true, true, now(), 'f1000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000003', 'f6000000-0000-0000-0000-000000000004', true, true, now(), 'f1000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000004', 'f6000000-0000-0000-0000-000000000005', true, true, now(), 'f1000000-0000-0000-0000-000000000004');

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(not has_table_privilege('anon', 'public.erp_outbox_events', 'select'), 'anon no lee el outbox');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.erp_outbox_events', 'insert'), 'authenticated no inserta en el outbox');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.erp_outbox_events', 'update'), 'authenticated no actualiza el outbox');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.erp_outbox_events', 'delete'), 'authenticated no borra el outbox');
select pg_temp.assert_true(not has_table_privilege('service_role', 'public.erp_outbox_events', 'update'), 'service_role escribe solo vía RPC');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_outbox_claim(integer, uuid)', 'execute'), 'anon no procesa');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_outbox_mark_failed(uuid, integer, text, text, boolean)', 'execute'), 'anon no cierra envíos');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.erp_outbox_dispatch_payload(uuid, uuid, timestamptz)', 'execute'), 'el armado del payload no se expone');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.erp_outbox_actor_company()', 'execute'), 'los helpers no se exponen');

/* ---------- Atomicidad: si el outbox falla, la confirmación se revierte entera ---------- */

create function public.erp04_fail_outbox_insert() returns trigger language plpgsql as $$
begin
  raise exception 'outbox no disponible (prueba)';
end;
$$;
create trigger erp04_fail_outbox before insert on public.erp_outbox_events
  for each row execute function public.erp04_fail_outbox_insert();

set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
do $$
begin
  perform * from public.confirm_dispatch_order('f7000000-0000-0000-0000-000000000002');
  raise exception 'US-ERP-04: la confirmación siguió aunque el outbox falló';
exception when raise_exception then
  if sqlerrm like 'US-ERP-04:%' then raise; end if;
end;
$$;
reset role;

select pg_temp.assert_true(
  (select status = 'draft' and confirmed_at is null from dispatch_orders where id = 'f7000000-0000-0000-0000-000000000002'),
  'sin outbox la orden queda en borrador');
select pg_temp.assert_true(
  (select status = 'assigned' from pallets where id = 'f6000000-0000-0000-0000-000000000003'),
  'sin outbox el pallet no sale a tránsito');
select pg_temp.assert_true(
  not exists (select 1 from traceability_events where order_id = 'f7000000-0000-0000-0000-000000000002' and event_type = 'dispatch_confirmed'),
  'sin outbox no queda evento de despacho');
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000002'),
  'sin outbox no queda evento a medias');

drop trigger erp04_fail_outbox on public.erp_outbox_events;
drop function public.erp04_fail_outbox_insert();

/* ---------- Confirmación con outbox ---------- */

set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
do $$
declare result record;
begin
  select * into result from public.confirm_dispatch_order('f7000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'confirmed', 'depósito confirma SO-1');
  select * into result from public.confirm_dispatch_order('f7000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true(result.outcome = 'confirmed', 'depósito confirma SO-2 sin la falla');
  select * into result from public.confirm_dispatch_order('f7000000-0000-0000-0000-000000000003');
  perform pg_temp.assert_true(result.outcome = 'confirmed', 'depósito confirma la orden manual');

  -- Confirmar dos veces no genera dos reportes.
  select * into result from public.confirm_dispatch_order('f7000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'invalid_status', 'la segunda confirmación se rechaza');
end;
$$;
reset role;

select pg_temp.assert_true(
  (select count(*) from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000001') = 1,
  'confirmar dos veces deja un solo reporte');
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000003'),
  'una orden cargada a mano no se reporta al ERP');

do $$
declare
  event erp_outbox_events;
  confirmed timestamptz;
begin
  select * into event from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000001';
  select confirmed_at into confirmed from dispatch_orders where id = 'f7000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true(event.company_id = 'f2000000-0000-0000-0000-000000000001', 'el evento es de la empresa de la orden');
  perform pg_temp.assert_true(event.event_type = 'dispatch_confirmed', 'tipo de evento');
  perform pg_temp.assert_true(event.idempotency_key = 'dispatch:SO-1', 'clave de idempotencia dispatch:{orderExternalId}');
  perform pg_temp.assert_true(event.status = 'pending' and event.attempts = 0 and event.sent_at is null, 'arranca pendiente y sin intentos');
  perform pg_temp.assert_true(event.next_attempt_at <= now(), 'se puede enviar enseguida');
  perform pg_temp.assert_true(event.created_by = 'f1000000-0000-0000-0000-000000000001', 'queda quién confirmó');
  perform pg_temp.assert_true(event.payload->>'idempotencyKey' = event.idempotency_key, 'el payload lleva la misma clave');
  perform pg_temp.assert_true((event.payload->>'contractVersion')::int = 1, 'versión de contrato');
  perform pg_temp.assert_true(event.payload->>'orderExternalId' = 'SO-1', 'orden externa');
  perform pg_temp.assert_true((event.payload->>'dispatchedAt')::timestamptz = date_trunc('milliseconds', confirmed), 'dispatchedAt es la hora de confirmación');
  perform pg_temp.assert_true(event.payload->>'dispatchedAt' like '%Z', 'dispatchedAt en UTC');
  perform pg_temp.assert_true(event.payload->'operator' = '{"id":"f1000000-0000-0000-0000-000000000001","name":"Operador Depósito A"}'::jsonb, 'operador');
  perform pg_temp.assert_true(event.payload->'lines' = $json$[
    {"orderLineExternalId":null,"palletCode":"PAL-ERP04-A","productExternalId":"QSO","lotExternalId":"Q-1","quantity":20.5,"uom":"Kg"},
    {"orderLineExternalId":"SO-1-1","palletCode":"PAL-ERP04-B","productExternalId":"ACE-500","lotExternalId":"L-2026-0915","quantity":45,"uom":"Caja"}
  ]$json$::jsonb, 'una línea por pallet, ordenadas, con lote físico y unidad del ERP; la línea de la orden solo si hay '
    'una sola del producto (TRZ-100): ' || (event.payload->'lines')::text);
end;
$$;

select pg_temp.assert_true(
  (select status = 'confirmed' from dispatch_orders where id = 'f7000000-0000-0000-0000-000000000001')
  and (select count(*) from pallets where id in ('f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000002') and status = 'in_transit') = 2,
  'el despacho físico quedó confirmado');

-- La clave es única aunque alguien intente otra fila con la misma clave.
do $$
begin
  insert into erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload)
  values ('f2000000-0000-0000-0000-000000000001', 'dispatch_confirmed', gen_random_uuid(), 'dispatch:SO-1', '{}');
  raise exception 'US-ERP-04: se aceptó una clave de idempotencia repetida';
exception when unique_violation then null;
end;
$$;

/* ---------- RLS de depósito y escrituras directas ---------- */

-- Empresa B confirma su orden (para ver aislamiento entre empresas).
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
select pg_temp.assert_true(
  (select outcome from public.confirm_dispatch_order('f7000000-0000-0000-0000-000000000004')) = 'confirmed',
  'depósito B confirma su orden');
select pg_temp.assert_true((select count(*) from erp_outbox_events) = 1, 'depósito B ve solo el reporte de su empresa');
select pg_temp.assert_true(
  not exists (select 1 from public.erp_outbox_claim(50, 'f7000000-0000-0000-0000-000000000001')),
  'depósito B no puede tomar reportes de la empresa A');

select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select count(*) from erp_outbox_events) = 2, 'depósito A ve los reportes de su empresa');
select pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((select count(*) from erp_outbox_events) = 2, 'logística A ve los reportes de su empresa');
select pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select count(*) from erp_outbox_events) = 0, 'un chofer no ve el outbox');

do $$
begin
  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000003');
  begin
    perform * from public.erp_outbox_claim(10, null);
    raise exception 'US-ERP-04: un chofer pudo procesar reportes';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
  begin
    update public.erp_outbox_events set status = 'sent', sent_at = now();
    raise exception 'US-ERP-04: depósito pudo marcar un reporte como enviado a mano';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.erp_outbox_events;
    raise exception 'US-ERP-04: depósito pudo borrar reportes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload)
    values ('f2000000-0000-0000-0000-000000000001', 'dispatch_confirmed', gen_random_uuid(), 'dispatch:FAKE', '{}');
    raise exception 'US-ERP-04: depósito pudo insertar un reporte';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.erp_outbox_requeue((select id from public.erp_outbox_events limit 1));
    raise exception 'US-ERP-04: depósito pudo pedir un reintento manual';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

/* ---------- Procesamiento: claim, timeout, reintento con backoff ---------- */

select set_config('test.so1', (select id::text from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000001'), true);
select set_config('test.so2', (select id::text from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000002'), true);
select set_config('test.so1_payload', (select payload::text from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000001'), true);

set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
do $$
declare
  claimed record;
  n integer := 0;
begin
  for claimed in select * from public.erp_outbox_claim(10, null) loop
    n := n + 1;
    perform pg_temp.assert_true(claimed.attempts = 1, 'el primer claim suma el primer intento');
    perform pg_temp.assert_true(claimed.payload->>'idempotencyKey' = claimed.idempotency_key, 'el claim devuelve payload y clave');
  end loop;
  perform pg_temp.assert_true(n = 2, 'depósito A toma los dos reportes de su empresa, no el de B (tomó ' || n || ')');
  perform pg_temp.assert_true(not exists (select 1 from public.erp_outbox_claim(10, null)), 'un evento en proceso no lo toma otro procesador');
end;
$$;
reset role;

select pg_temp.assert_true(
  (select status = 'processing' and locked_until > now() and last_attempt_at is not null
   from erp_outbox_events where id = current_setting('test.so1')::uuid),
  'el evento tomado queda en proceso con lease');

-- Timeout del ERP: reintentable → vuelve a pendiente con backoff de 30 s.
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  public.erp_outbox_mark_failed(current_setting('test.so1')::uuid, 1, 'timeout', 'El ERP no respondió a tiempo.', true) = 'pending',
  'un timeout deja el reporte pendiente');
select pg_temp.assert_true(
  not exists (select 1 from public.erp_outbox_claim(10, null) where id = current_setting('test.so1')::uuid),
  'no se reintenta antes del backoff');
reset role;

select pg_temp.assert_true(
  (select next_attempt_at = now() + interval '30 seconds' and last_error_code = 'timeout'
     and last_error = 'El ERP no respondió a tiempo.' and locked_until is null and attempts = 1
   from erp_outbox_events where id = current_setting('test.so1')::uuid),
  'backoff de 30 s y error guardado');

-- Pasa el backoff: se reintenta con el MISMO payload y la MISMA clave.
update erp_outbox_events set next_attempt_at = now() - interval '1 second' where id = current_setting('test.so1')::uuid;
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
do $$
declare claimed record;
begin
  select * into claimed from public.erp_outbox_claim(10, 'f7000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(claimed.attempts = 2, 'segundo intento');
  perform pg_temp.assert_true(claimed.idempotency_key = 'dispatch:SO-1', 'el reintento conserva la clave');
  perform pg_temp.assert_true(claimed.payload = current_setting('test.so1_payload')::jsonb, 'el reintento conserva el payload');
  perform pg_temp.assert_true(
    public.erp_outbox_mark_failed(claimed.id, 2, 'unavailable', 'Error interno del ERP.', true) = 'pending',
    'un 5xx también se reintenta');
end;
$$;
reset role;
select pg_temp.assert_true(
  (select next_attempt_at = now() + interval '1 minute' from erp_outbox_events where id = current_setting('test.so1')::uuid),
  'el backoff se duplica');
select pg_temp.assert_true(
  public.erp_outbox_backoff(3) = interval '2 minutes' and public.erp_outbox_backoff(7) = interval '32 minutes'
  and public.erp_outbox_backoff(8) = interval '1 hour' and public.erp_outbox_backoff(20) = interval '1 hour',
  'backoff exponencial con tope de 1 h');

-- Lease vencido (el procesador se cortó en medio del envío): otro lo retoma y el resultado viejo se descarta.
update erp_outbox_events set next_attempt_at = now() - interval '1 second' where id = current_setting('test.so1')::uuid;
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select attempts from public.erp_outbox_claim(10, 'f7000000-0000-0000-0000-000000000001')) = 3, 'tercer intento');
reset role;
update erp_outbox_events set locked_until = now() - interval '1 second' where id = current_setting('test.so1')::uuid;
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select attempts from public.erp_outbox_claim(10, 'f7000000-0000-0000-0000-000000000001')) = 4,
  'un lease vencido se retoma (logística también puede procesar)');
select pg_temp.assert_true(
  public.erp_outbox_mark_sent(current_setting('test.so1')::uuid, 3, 'VIEJO', false) is false,
  'el resultado de un intento retomado se descarta');

-- Éxito.
select pg_temp.assert_true(
  public.erp_outbox_mark_sent(current_setting('test.so1')::uuid, 4, 'MOCK-DN-0001', false),
  'se marca enviado');
select pg_temp.assert_true(
  not exists (select 1 from public.erp_outbox_claim(10, 'f7000000-0000-0000-0000-000000000001')),
  'un reporte enviado no se vuelve a enviar');
select pg_temp.assert_true(
  public.erp_outbox_requeue(current_setting('test.so1')::uuid) is false,
  'un reporte enviado no se puede reencolar');
reset role;
select pg_temp.assert_true(
  (select status = 'sent' and sent_at is not null and erp_reference = 'MOCK-DN-0001' and erp_duplicate = false
     and last_error is null and locked_until is null and payload = current_setting('test.so1_payload')::jsonb
   from erp_outbox_events where id = current_setting('test.so1')::uuid),
  'enviado con referencia del ERP y el payload original');

/* ---------- Error permanente y reintento manual ---------- */

set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  public.erp_outbox_mark_failed(current_setting('test.so2')::uuid, 1, 'validation', 'La orden SO-2 está cerrada en el ERP.', false) = 'failed',
  'un error de validación es permanente');
select pg_temp.assert_true(
  not exists (select 1 from public.erp_outbox_claim(10, 'f7000000-0000-0000-0000-000000000002')),
  'un error permanente no se reintenta solo');

select pg_temp.as_user('f1000000-0000-0000-0000-000000000005');
select pg_temp.assert_true(
  public.erp_outbox_requeue(current_setting('test.so2')::uuid) is false,
  'logística de otra empresa no puede reencolarlo');

select pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(public.erp_outbox_requeue(current_setting('test.so2')::uuid), 'logística reencola el reporte');
do $$
declare claimed record;
begin
  select * into claimed from public.erp_outbox_claim(10, 'f7000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true(claimed.attempts = 2 and claimed.idempotency_key = 'dispatch:SO-2', 'el reintento manual usa la misma clave');
  perform pg_temp.assert_true(
    public.erp_outbox_mark_sent(claimed.id, claimed.attempts, 'MOCK-DN-0001', true),
    'un duplicado del ERP cuenta como enviado');
end;
$$;
reset role;
select pg_temp.assert_true(
  (select status = 'sent' and erp_duplicate from erp_outbox_events where id = current_setting('test.so2')::uuid),
  'queda registrado que el ERP ya lo tenía');

/* ---------- Reintentos agotados ---------- */

select set_config('test.sob', (select id::text from erp_outbox_events where aggregate_id = 'f7000000-0000-0000-0000-000000000004'), true);
update erp_outbox_events set attempts = 9 where id = current_setting('test.sob')::uuid;
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
do $$
declare claimed record;
begin
  select * into claimed from public.erp_outbox_claim(10, null);
  perform pg_temp.assert_true(claimed.attempts = 10, 'décimo intento');
  perform pg_temp.assert_true(
    public.erp_outbox_mark_failed(claimed.id, 10, 'timeout', 'El ERP no respondió a tiempo.', true) = 'failed',
    'con los intentos agotados un timeout pasa a failed');
end;
$$;
reset role;

-- Un envío interrumpido sin intentos disponibles también termina en failed al vencer el lease.
update erp_outbox_events
set status = 'processing', locked_until = now() - interval '1 second', last_error = null, last_error_code = null
where id = current_setting('test.sob')::uuid;
set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000004');
select pg_temp.assert_true(not exists (select 1 from public.erp_outbox_claim(10, null)), 'no se retoma sin intentos');
reset role;
select pg_temp.assert_true(
  (select status = 'failed' and locked_until is null and last_error like 'Se agotaron%' from erp_outbox_events where id = current_setting('test.sob')::uuid),
  'queda failed con el motivo');

/* ---------- Procesador del servidor (service_role, sin usuario) ---------- */

update erp_outbox_events set status = 'pending', next_attempt_at = now() - interval '1 second', attempts = 0
where id = current_setting('test.sob')::uuid;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true);
select pg_temp.assert_true(
  (select count(*) from public.erp_outbox_claim(50, null) where id = current_setting('test.sob')::uuid) = 1,
  'el procesador del servidor toma pendientes de cualquier empresa');
select pg_temp.assert_true(
  public.erp_outbox_mark_sent(current_setting('test.sob')::uuid, 1, 'MOCK-DN-0002', false),
  'y los puede cerrar');
reset role;

/* ---------- Inmutabilidad ---------- */

do $$
begin
  update erp_outbox_events set payload = payload || '{"lines":[]}' where id = current_setting('test.so1')::uuid;
  raise exception 'US-ERP-04: se pudo modificar el payload';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  update erp_outbox_events set idempotency_key = 'dispatch:OTRA' where id = current_setting('test.so1')::uuid;
  raise exception 'US-ERP-04: se pudo modificar la clave de idempotencia';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  delete from erp_outbox_events where id = current_setting('test.so1')::uuid;
  raise exception 'US-ERP-04: se pudo borrar un evento';
exception when insufficient_privilege then null;
end;
$$;

/* ---------- La sincronización guarda la unidad del ERP ---------- */

set local role authenticated;
select pg_temp.as_user('f1000000-0000-0000-0000-000000000002');
do $$
declare run_id uuid := public.erp_sync_start('f2000000-0000-0000-0000-000000000001', auth.uid(), 'mock');
begin
  perform public.erp_sync_apply_products(run_id, $json$[
    {"externalId":"QSO","sku":"QSO","name":"Queso","uom":"Kg","unit":"kilogramos","active":true},
    {"externalId":"ARR","sku":"ARR","name":"Arroz","uom":"Box","unit":"cajas","active":true}
  ]$json$);
  perform public.erp_sync_finish(run_id, null);
end;
$$;
select pg_temp.assert_true(
  (select external_uom from products where company_id = 'f2000000-0000-0000-0000-000000000001' and external_id = 'QSO') = 'Kg',
  'la re-sincronización completa la unidad del ERP');
select pg_temp.assert_true(
  (select external_uom from products where company_id = 'f2000000-0000-0000-0000-000000000001' and external_id = 'ARR') = 'Box',
  'un producto nuevo guarda la unidad tal como la nombra el ERP');
do $$
begin
  update public.products set external_uom = 'Bolsa' where external_id = 'ARR';
  raise exception 'US-ERP-04: logística pudo cambiar la unidad del ERP';
exception when insufficient_privilege then null;
end;
$$;
reset role;

do $$
begin
  insert into products (company_id, sku, name, unit_of_measure, external_uom)
  values ('f2000000-0000-0000-0000-000000000001', 'MANUAL-2', 'Manual', 'cajas', 'Caja');
  raise exception 'US-ERP-04: un producto manual aceptó external_uom';
exception when check_violation then null;
end;
$$;

rollback;
