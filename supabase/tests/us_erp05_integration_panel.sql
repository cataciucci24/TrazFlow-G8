-- US-ERP-05: panel de integración ERP (lecturas, reintento manual y auditoría).
-- Ejecutar con psql -v ON_ERROR_STOP=1 -f supabase/tests/us_erp05_integration_panel.sql sobre una base local
-- migrada. Todo se revierte al final.
--
-- Cubre: permisos (operador, chofer, logística de otra empresa, anon), filtros, paginación, despachadas sin
-- reportar, detalle sin datos sensibles, reintento solo de fallidos sin tocar el payload ni crear eventos,
-- auditoría del reintento, envío extra con intentos agotados (vuelve a failed, no queda en processing) y
-- RLS de erp_outbox_retry_requests.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'US-ERP-05: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

-- Espera un error con el SQLSTATE indicado al ejecutar p_sql.
create or replace function pg_temp.assert_raises(p_sql text, p_state text, message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'US-ERP-05: % (no falló)', message;
exception when others then
  if sqlstate <> p_state then
    raise exception 'US-ERP-05: % (esperaba %, obtuvo %: %)', message, p_state, sqlstate, sqlerrm;
  end if;
end;
$$;

/* ---------- Fixtures ---------- */

insert into auth.users (id, email) values
  ('e5100000-0000-0000-0000-000000000001', 'erp05-manager-a@test.local'),
  ('e5100000-0000-0000-0000-000000000002', 'erp05-warehouse-a@test.local'),
  ('e5100000-0000-0000-0000-000000000003', 'erp05-driver-a@test.local'),
  ('e5100000-0000-0000-0000-000000000004', 'erp05-manager-b@test.local');
insert into companies (id, name) values
  ('e5200000-0000-0000-0000-000000000001', 'ERP05 Company A'),
  ('e5200000-0000-0000-0000-000000000002', 'ERP05 Company B');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('e5100000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'Logística A', 'erp05-manager-a@test.local', 'logistics_manager'),
  ('e5100000-0000-0000-0000-000000000002', 'e5200000-0000-0000-0000-000000000001', 'Operador A', 'erp05-warehouse-a@test.local', 'warehouse_operator'),
  ('e5100000-0000-0000-0000-000000000003', 'e5200000-0000-0000-0000-000000000001', 'Chofer A', 'erp05-driver-a@test.local', 'driver_operator'),
  ('e5100000-0000-0000-0000-000000000004', 'e5200000-0000-0000-0000-000000000002', 'Logística B', 'erp05-manager-b@test.local', 'logistics_manager');

insert into distributors (id, company_id, name, external_id, source_system) values
  ('e5300000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'Distribuidora Norte', 'CUST-N', 'erp'),
  ('e5300000-0000-0000-0000-000000000002', 'e5200000-0000-0000-0000-000000000002', 'Cliente B', 'CUST-B', 'erp');
insert into products (id, company_id, sku, name, unit_of_measure, external_uom, external_id, source_system) values
  ('e5400000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'ACE-500', 'Aceite', 'cajas', 'Caja', 'ACE-500', 'erp');
insert into batches (id, product_id, batch_number, quantity, external_id, source_system) values
  ('e5500000-0000-0000-0000-000000000001', 'e5400000-0000-0000-0000-000000000001', 'L-0915', 0, 'L-0915', 'erp');
-- TRZ-100: todo pallet de un lote del ERP necesita saldo en el depósito (tope por saldo).
insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values
  ('e5200000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 'e5100000-0000-0000-0000-000000000001');
insert into erp_stock_balances (company_id, batch_id, external_warehouse_id, warehouse_code, quantity) values
  ('e5200000-0000-0000-0000-000000000001', 'e5500000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 120);
insert into pallets (id, company_id, batch_id, qr_code, status, quantity, external_id, source_system) values
  ('e5600000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'e5500000-0000-0000-0000-000000000001', 'PAL-ERP05-1', 'in_transit', 45, 'stock:L-0915@Central', 'erp');

-- Órdenes de A: SO-1 (reporte enviado), SO-2 (fallido), SO-3 (pendiente), SO-4 (despachada sin evento:
-- el escenario del bug de idempotency_key), SO-5 (del ERP pero sin despachar), MANUAL (despachada, sin ERP).
-- B: SO-1 (mismo id externo que A).
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at, external_id, source_system) values
  ('e5700000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'confirmed', '2026-10-10', '2026-10-10 12:00Z', 'SO-1', 'erp'),
  ('e5700000-0000-0000-0000-000000000002', 'e5200000-0000-0000-0000-000000000001', 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'confirmed', '2026-10-12', '2026-10-12 12:00Z', 'SO-2', 'erp'),
  ('e5700000-0000-0000-0000-000000000003', 'e5200000-0000-0000-0000-000000000001', 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'confirmed', '2026-10-14', '2026-10-14 12:00Z', 'SO-3', 'erp'),
  ('e5700000-0000-0000-0000-000000000004', 'e5200000-0000-0000-0000-000000000001', 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'delivered', '2026-10-09', '2026-10-09 12:00Z', 'SO-4', 'erp'),
  ('e5700000-0000-0000-0000-000000000005', 'e5200000-0000-0000-0000-000000000001', 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'draft', '2026-10-20', null, 'SO-5', 'erp'),
  ('e5700000-0000-0000-0000-000000000009', 'e5200000-0000-0000-0000-000000000001', 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'confirmed', '2026-10-11', '2026-10-11 12:00Z', null, 'trazflow'),
  ('e5700000-0000-0000-0000-000000000011', 'e5200000-0000-0000-0000-000000000002', 'e5300000-0000-0000-0000-000000000002', 'e5100000-0000-0000-0000-000000000004', 'confirmed', '2026-10-12', '2026-10-12 12:00Z', 'SO-1', 'erp');

create or replace function pg_temp.payload(p_order text, p_pallet text) returns jsonb language sql as $$
  select jsonb_build_object(
    'contractVersion', 1, 'idempotencyKey', 'dispatch:' || p_order, 'orderExternalId', p_order,
    'dispatchedAt', '2026-10-10T12:00:00.000Z',
    'operator', jsonb_build_object('id', 'e5100000-0000-0000-0000-000000000002', 'name', 'Operador A'),
    'lines', jsonb_build_array(jsonb_build_object(
      'orderLineExternalId', null, 'palletCode', p_pallet, 'productExternalId', 'ACE-500',
      'lotExternalId', 'L-0915', 'quantity', 45, 'uom', 'Caja')));
$$;

insert into erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, status, attempts,
    next_attempt_at, last_error_code, last_error, erp_reference, erp_duplicate, sent_at, created_by, created_at) values
  ('e5800000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'dispatch_confirmed', 'e5700000-0000-0000-0000-000000000001',
   'dispatch:SO-1', pg_temp.payload('SO-1', 'PAL-ERP05-1'), 'sent', 1, '2026-10-10 12:00Z', null, null, 'MOCK-DN-0001', false, '2026-10-10 12:01Z',
   'e5100000-0000-0000-0000-000000000002', '2026-10-10 12:00Z'),
  ('e5800000-0000-0000-0000-000000000002', 'e5200000-0000-0000-0000-000000000001', 'dispatch_confirmed', 'e5700000-0000-0000-0000-000000000002',
   'dispatch:SO-2', pg_temp.payload('SO-2', 'PAL-ERP05-2'), 'failed', 3, '2026-10-12 12:05Z', 'validation',
   'El ERP rechazó el reporte (mock). token abc:def https://erp.interno.local/api', null, null, null,
   'e5100000-0000-0000-0000-000000000002', '2026-10-12 12:00Z'),
  ('e5800000-0000-0000-0000-000000000003', 'e5200000-0000-0000-0000-000000000001', 'dispatch_confirmed', 'e5700000-0000-0000-0000-000000000003',
   'dispatch:SO-3', pg_temp.payload('SO-3', 'PAL-ERP05-3'), 'pending', 1, '2026-10-14 12:30Z', 'timeout', 'El ERP no respondió a tiempo (mock).', null, null, null,
   'e5100000-0000-0000-0000-000000000002', '2026-10-14 12:00Z'),
  -- B usa la clave "dispatch:SO-1-B" solo para poder existir en este test (ver bug de idempotency_key en el doc).
  ('e5800000-0000-0000-0000-000000000011', 'e5200000-0000-0000-0000-000000000002', 'dispatch_confirmed', 'e5700000-0000-0000-0000-000000000011',
   'dispatch:SO-1-B', pg_temp.payload('SO-1', 'PAL-B-1'), 'failed', 1, '2026-10-12 12:00Z', 'unauthorized', 'Credenciales inválidas (mock).', null, null, null,
   null, '2026-10-12 12:00Z');

insert into erp_sync_runs (id, company_id, triggered_by, provider, status, started_at, finished_at, counters, errors, error_message) values
  ('e5900000-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'mock', 'success',
   '2026-10-08 10:00Z', '2026-10-08 10:01Z', '{"products":{"received":4,"created":4}}', '[]', null),
  ('e5900000-0000-0000-0000-000000000002', 'e5200000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'mock', 'partial',
   '2026-10-13 10:00Z', '2026-10-13 10:01Z', '{"stock":{"received":2,"failed":1}}',
   '[{"entity":"stock","external_id":"stock:L-9@Sin vincular","message":"El depósito no tiene correspondencia."}]', null),
  ('e5900000-0000-0000-0000-000000000003', 'e5200000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'mock', 'failed',
   '2026-10-15 10:00Z', '2026-10-15 10:00Z', '{}', '[]', 'Al leer productos, lotes y stock del ERP: El ERP no respondió a tiempo (mock).'),
  ('e5900000-0000-0000-0000-000000000011', 'e5200000-0000-0000-0000-000000000002', 'e5100000-0000-0000-0000-000000000004', 'mock', 'success',
   '2026-10-15 10:00Z', '2026-10-15 10:01Z', '{}', '[]', null);

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_outbox_retry_failed(uuid)', 'execute'), 'anon no reintenta');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_integration_activity(text, text, timestamptz, timestamptz, text, integer, integer)', 'execute'), 'anon no lee actividad');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_integration_summary()', 'execute'), 'anon no lee el resumen');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_dispatched_unreported(integer, integer)', 'execute'), 'anon no lee despachadas sin reportar');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_integration_event_detail(text, uuid)', 'execute'), 'anon no lee el detalle');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.erp_outbox_retry_requests', 'select'), 'anon no lee la auditoría');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.erp_outbox_retry_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.erp_outbox_retry_requests', 'update')
  and not has_table_privilege('authenticated', 'public.erp_outbox_retry_requests', 'delete'), 'authenticated no escribe la auditoría');
select pg_temp.assert_true(
  (select prosecdef from pg_proc where oid = 'public.erp_outbox_retry_failed(uuid)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.erp_outbox_retry_failed(uuid)'::regprocedure) = array['search_path=""'],
  'el reintento es SECURITY DEFINER con search_path fijo');
select pg_temp.assert_true(
  not (select bool_or(prosecdef) from pg_proc where proname in
    ('erp_integration_activity', 'erp_integration_summary', 'erp_dispatched_unreported', 'erp_integration_event_detail')),
  'las lecturas son SECURITY INVOKER (aplican RLS)');

/* ---------- Operador y chofer: no ven ni reintentan ---------- */

set local role authenticated;

do $$
declare
  usr uuid;
begin
  foreach usr in array array['e5100000-0000-0000-0000-000000000002', 'e5100000-0000-0000-0000-000000000003']::uuid[] loop
    perform pg_temp.as_user(usr);
    perform pg_temp.assert_raises('select * from public.erp_integration_activity()', '42501', 'operador/chofer no lee actividad');
    perform pg_temp.assert_raises('select * from public.erp_integration_summary()', '42501', 'operador/chofer no lee el resumen');
    perform pg_temp.assert_raises('select * from public.erp_dispatched_unreported()', '42501', 'operador/chofer no lee despachadas sin reportar');
    perform pg_temp.assert_raises($q$select public.erp_integration_event_detail('dispatch_confirmed', 'e5800000-0000-0000-0000-000000000002')$q$, '42501', 'operador/chofer no lee el detalle');
    perform pg_temp.assert_raises($q$select public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000002')$q$, '42501', 'operador/chofer no reintenta');
    perform pg_temp.assert_true((select count(*) from public.erp_outbox_retry_requests) = 0, 'operador/chofer no lee la auditoría');
  end loop;
end;
$$;

/* ---------- Logística de otra empresa ---------- */

select pg_temp.as_user('e5100000-0000-0000-0000-000000000004');
select pg_temp.assert_true((select count(*) from erp_integration_activity()) = 2, 'logística B ve solo su actividad (1 sync + 1 reporte)');
select pg_temp.assert_true(
  (select erp_integration_event_detail('dispatch_confirmed', 'e5800000-0000-0000-0000-000000000002')) is null,
  'logística B no ve el detalle de un reporte de A');
select pg_temp.assert_raises($q$select public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000002')$q$, 'P0002',
  'logística B no reintenta un reporte de A (responde como inexistente)');
select pg_temp.assert_true((select count(*) from erp_dispatched_unreported()) = 1, 'logística B ve solo su orden sin reportar');

/* ---------- Logística A: actividad, filtros y paginación ---------- */

select pg_temp.as_user('e5100000-0000-0000-0000-000000000001');

select pg_temp.assert_true((select count(*) from erp_integration_activity()) = 6, 'logística A ve 3 syncs + 3 reportes');
select pg_temp.assert_true(
  (select array_agg(id order by occurred_at desc) from erp_integration_activity()) =
  (select array_agg(id) from erp_integration_activity()),
  'la actividad viene ordenada por fecha descendente');
select pg_temp.assert_true((select count(*) from erp_integration_activity(p_kind => 'sync')) = 3, 'filtro por tipo: sincronización');
select pg_temp.assert_true((select count(*) from erp_integration_activity(p_kind => 'dispatch_confirmed')) = 3, 'filtro por tipo: despacho');
select pg_temp.assert_true(
  (select array_agg(id order by id) from erp_integration_activity(p_status => 'failed')) =
  array['e5800000-0000-0000-0000-000000000002', 'e5900000-0000-0000-0000-000000000003']::uuid[],
  'filtro por estado failed abarca syncs y reportes');
select pg_temp.assert_true((select count(*) from erp_integration_activity(p_kind => 'sync', p_status => 'pending')) = 0, 'filtros combinados');
select pg_temp.assert_true(
  (select array_agg(id order by id) from erp_integration_activity(p_from => '2026-10-12 00:00Z', p_to => '2026-10-14 00:00Z')) =
  array['e5800000-0000-0000-0000-000000000002', 'e5900000-0000-0000-0000-000000000002']::uuid[],
  'filtro por rango de fechas (fin exclusivo)');
select pg_temp.assert_true((select array_agg(id) from erp_integration_activity(p_search => 'so-2')) = array['e5800000-0000-0000-0000-000000000002']::uuid[],
  'búsqueda por orden externa, sin distinguir mayúsculas');
select pg_temp.assert_true((select array_agg(id) from erp_integration_activity(p_search => 'PAL-ERP05-3')) = array['e5800000-0000-0000-0000-000000000003']::uuid[],
  'búsqueda por QR del pallet');
select pg_temp.assert_true((select array_agg(id) from erp_integration_activity(p_search => 'L-0915@Central')) = array['e5800000-0000-0000-0000-000000000001']::uuid[],
  'búsqueda por external_id del pallet');
select pg_temp.assert_true((select array_agg(id) from erp_integration_activity(p_search => 'Sin vincular')) = array['e5900000-0000-0000-0000-000000000002']::uuid[],
  'búsqueda por external_id de un error de sincronización');
select pg_temp.assert_true((select count(*) from erp_integration_activity(p_search => '%')) = 0, 'un % en la búsqueda es literal');
select pg_temp.assert_true((select count(*) from erp_integration_activity(p_search => '   ')) = 6, 'una búsqueda vacía no filtra');
select pg_temp.assert_raises($q$select * from public.erp_integration_activity(p_status => 'borrador')$q$, '22023', 'estado inválido');
select pg_temp.assert_raises($q$select * from public.erp_integration_activity(p_kind => 'otro')$q$, '22023', 'tipo inválido');
select pg_temp.assert_raises($q$select * from public.erp_integration_activity(p_from => '2026-10-14Z', p_to => '2026-10-12Z')$q$, '22023', 'rango invertido');
select pg_temp.assert_raises($q$select * from public.erp_integration_activity(p_search => repeat('x', 101))$q$, '22023', 'búsqueda demasiado larga');

do $$
declare
  first_page uuid[];
  second_page uuid[];
  third_page uuid[];
  totals bigint[];
begin
  select array_agg(id), array_agg(total_count) into first_page, totals from public.erp_integration_activity(p_limit => 4, p_offset => 0);
  select array_agg(id) into second_page from public.erp_integration_activity(p_limit => 4, p_offset => 4);
  select array_agg(id) into third_page from public.erp_integration_activity(p_limit => 4, p_offset => 8);
  perform pg_temp.assert_true(array_length(first_page, 1) = 4 and array_length(second_page, 1) = 2, 'páginas de 4 y 2');
  perform pg_temp.assert_true(not (first_page && second_page), 'las páginas no se superponen');
  perform pg_temp.assert_true(third_page is null, 'una página fuera de rango viene vacía');
  perform pg_temp.assert_true(totals[1] = 6 and totals[4] = 6, 'total_count informa el total filtrado');
  perform pg_temp.assert_true((select max(total_count) from public.erp_integration_activity(p_status => 'failed', p_limit => 1)) = 2,
    'total_count respeta los filtros');
  perform pg_temp.assert_true((select count(*) from public.erp_integration_activity(p_limit => 1000)) = 6, 'el límite se acota a 100');
end;
$$;

/* ---------- Despachadas sin reportar y resumen ---------- */

select pg_temp.assert_true(
  (select array_agg(order_external_id || ':' || event_status order by confirmed_at) from erp_dispatched_unreported()) =
  array['SO-4:missing', 'SO-2:failed', 'SO-3:pending'],
  'despachadas sin reportar: sin evento, fallida y pendiente; no la enviada, la de borrador ni la manual');
select pg_temp.assert_true((select max(total_count) from erp_dispatched_unreported(p_limit => 1)) = 3, 'total de despachadas sin reportar');

do $$
declare
  s record;
begin
  select * into s from public.erp_integration_summary();
  perform pg_temp.assert_true(s.pending_count = 1 and s.processing_count = 0 and s.failed_count = 1 and s.sent_count = 1, 'conteos del outbox');
  perform pg_temp.assert_true(s.last_run_id = 'e5900000-0000-0000-0000-000000000003' and s.last_run_status = 'failed', 'última sincronización');
  perform pg_temp.assert_true(s.last_success_at = '2026-10-08 10:01Z', 'última sincronización exitosa');
  perform pg_temp.assert_true(s.unreported_count = 3 and s.running_sync_count = 0, 'despachadas sin reportar en el resumen');
end;
$$;

/* ---------- Detalle: sin datos sensibles ---------- */

do $$
declare
  detail jsonb := public.erp_integration_event_detail('dispatch_confirmed', 'e5800000-0000-0000-0000-000000000002');
  sync_detail jsonb := public.erp_integration_event_detail('sync', 'e5900000-0000-0000-0000-000000000002');
begin
  perform pg_temp.assert_true(detail->>'status' = 'failed' and detail->>'errorCode' = 'validation' and (detail->'order'->>'externalId') = 'SO-2', 'detalle del reporte');
  perform pg_temp.assert_true(jsonb_array_length(detail->'lines') = 1 and detail->'lines'->0->>'palletCode' = 'PAL-ERP05-2', 'líneas del reporte');
  perform pg_temp.assert_true(detail::text not like '%Operador A%' and detail::text not like '%e5100000-0000-0000-0000-000000000002%'
    and detail::text not like '%idempotency%' and detail::text not like '%dispatch:SO-2%', 'el detalle no expone operador ni clave');
  perform pg_temp.assert_true(sync_detail->>'status' = 'partial' and jsonb_array_length(sync_detail->'errors') = 1, 'detalle de la sincronización');
  perform pg_temp.assert_true(public.erp_integration_event_detail('sync', 'e5800000-0000-0000-0000-000000000002') is null, 'tipo y id deben coincidir');
  -- TRZ-100: estado del remito y línea de la orden.
  perform pg_temp.assert_true(detail ? 'erpDocumentStatus' and detail->'lines'->0 ? 'orderLineExternalId', 'el detalle trae el estado del remito y la línea de la orden');
end;
$$;

-- TRZ-100: la lista de reportes muestra el estado del remito (null = sin consultar; null también en las syncs).
do $$
begin
  perform pg_temp.assert_true(
    (select erp_document_status from public.erp_integration_activity(p_kind => 'dispatch_confirmed') where id = 'e5800000-0000-0000-0000-000000000001') is null
    and (select bool_and(erp_document_status is null) from public.erp_integration_activity(p_kind => 'sync')),
    'reporte enviado sin consultar y sincronizaciones sin estado de remito');
  perform pg_temp.assert_true(public.erp_outbox_record_dispatch_document('e5800000-0000-0000-0000-000000000001', 'draft', 'MAT-DN-0001'), 'logística registra el remito');
  perform pg_temp.assert_true(
    (select erp_document_status from public.erp_integration_activity(p_kind => 'dispatch_confirmed') where id = 'e5800000-0000-0000-0000-000000000001') = 'draft'
    and (select erp_reference from public.erp_integration_activity(p_kind => 'dispatch_confirmed') where id = 'e5800000-0000-0000-0000-000000000001') = 'MAT-DN-0001',
    'la lista muestra el remito en borrador con su referencia');
end;
$$;
select pg_temp.assert_raises($q$select public.erp_integration_event_detail('otro', gen_random_uuid())$q$, '22023', 'detalle con tipo inválido');

/* ---------- Reintento ---------- */

reset role;
select set_config('test.payload_before', (select payload::text from erp_outbox_events where id = 'e5800000-0000-0000-0000-000000000002'), true);
select set_config('test.events_before', (select count(*)::text from erp_outbox_events), true);
set local role authenticated;
select pg_temp.as_user('e5100000-0000-0000-0000-000000000001');

select pg_temp.assert_raises($q$select public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000003')$q$, '55000', 'un reporte pendiente no se reintenta');
select pg_temp.assert_raises($q$select public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000001')$q$, '55000', 'un reporte enviado no se reintenta');
select pg_temp.assert_raises($q$select public.erp_outbox_retry_failed(gen_random_uuid())$q$, 'P0002', 'un reporte inexistente');
select pg_temp.assert_true(
  public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000002') = 'e5700000-0000-0000-0000-000000000002',
  'el reintento devuelve la orden del reporte');
select pg_temp.assert_raises($q$select public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000002')$q$, '55000', 'reintentar dos veces seguidas no duplica');

reset role;
select pg_temp.assert_true(
  (select status = 'pending' and next_attempt_at <= now() and attempts = 3 and locked_until is null
     and payload::text = current_setting('test.payload_before') and idempotency_key = 'dispatch:SO-2'
   from erp_outbox_events where id = 'e5800000-0000-0000-0000-000000000002'),
  'el reintento vuelve a pending sin tocar payload, clave ni intentos');
select pg_temp.assert_true((select count(*)::text from erp_outbox_events) = current_setting('test.events_before'), 'el reintento no crea eventos');
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(previous_status = 'failed' and previous_attempts = 3 and previous_error_code = 'validation'
     and requested_by = 'e5100000-0000-0000-0000-000000000001' and company_id = 'e5200000-0000-0000-0000-000000000001')
   from erp_outbox_retry_requests where event_id = 'e5800000-0000-0000-0000-000000000002'),
  'el reintento queda auditado');
set local role authenticated;
select pg_temp.assert_true(
  jsonb_array_length(erp_integration_event_detail('dispatch_confirmed', 'e5800000-0000-0000-0000-000000000002')->'retries') = 1,
  'el detalle muestra el historial de reintentos');
select pg_temp.assert_true((select count(*) from erp_outbox_retry_requests) = 1, 'logística A lee su auditoría');
select pg_temp.as_user('e5100000-0000-0000-0000-000000000004');
select pg_temp.assert_true((select count(*) from erp_outbox_retry_requests) = 0, 'logística B no lee la auditoría de A');

/* ---------- Envío extra con intentos agotados ---------- */

-- Evento con los 10 intentos agotados. Tras el reintento manual recibe un envío más; si falla (aunque
-- sea reintentable) vuelve a failed. Si el procesador se corta, al vencer el lease también queda failed.
reset role;
update erp_outbox_events set attempts = 10 where id = 'e5800000-0000-0000-0000-000000000002';
update erp_outbox_events set status = 'failed', attempts = 10, last_error_code = 'timeout', next_attempt_at = now()
  where id = 'e5800000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.as_user('e5100000-0000-0000-0000-000000000001');

do $$
declare
  claimed record;
  new_status text;
begin
  select * into claimed from public.erp_outbox_claim(10, 'e5700000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true(claimed.id = 'e5800000-0000-0000-0000-000000000002' and claimed.attempts = 11, 'el envío extra se toma y suma un intento');
  new_status := public.erp_outbox_mark_failed(claimed.id, claimed.attempts, 'timeout', 'El ERP no respondió a tiempo (mock).', true);
  perform pg_temp.assert_true(new_status = 'failed', 'si el envío extra falla, vuelve a failed aunque el error sea reintentable');

  perform public.erp_outbox_retry_failed('e5800000-0000-0000-0000-000000000003');
  select * into claimed from public.erp_outbox_claim(10, 'e5700000-0000-0000-0000-000000000003');
  perform pg_temp.assert_true(claimed.attempts = 11, 'el segundo evento también se toma');
end;
$$;

-- El procesador se cortó: el lease vence y el evento no queda atascado en processing.
reset role;
update erp_outbox_events set locked_until = now() - interval '1 second' where id = 'e5800000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.as_user('e5100000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  not exists (select 1 from public.erp_outbox_claim(10, 'e5700000-0000-0000-0000-000000000003')),
  'un envío extra interrumpido no se vuelve a tomar');
reset role;
select pg_temp.assert_true(
  (select status = 'failed' and locked_until is null from erp_outbox_events where id = 'e5800000-0000-0000-0000-000000000003'),
  'un envío extra interrumpido termina en failed, no en processing');
select pg_temp.assert_true(
  (select status = 'failed' and attempts = 11 from erp_outbox_events where id = 'e5800000-0000-0000-0000-000000000002'),
  'el evento queda en failed con el intento contado');

rollback;
