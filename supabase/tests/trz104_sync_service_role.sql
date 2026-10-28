-- TRZ-104: sincronización automática (cron) con service_role, sin usuario.
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-104: %', message; end if;
end;
$$;

create or replace function pg_temp.as_service()
returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true);
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;

-- Sincronización completa con los datos de prueba; p_actor null = automática.
create or replace function pg_temp.sync(p_company uuid, p_actor uuid, p_suffix text)
returns public.erp_sync_runs language plpgsql as $$
declare
  run_id uuid := public.erp_sync_start(p_company, p_actor, 'mock');
begin
  perform public.erp_sync_save_dispatch_documents(run_id, '{"received":0}', '[]');
  perform public.erp_sync_apply_warehouses(run_id, jsonb_build_array(
    jsonb_build_object('externalId', 'Central ' || p_suffix, 'name', 'Central ' || p_suffix, 'active', true)));
  perform public.erp_sync_apply_products(run_id, jsonb_build_array(
    jsonb_build_object('externalId', 'P-' || p_suffix, 'sku', 'P-' || p_suffix, 'name', 'Producto ' || p_suffix,
                       'uom', 'Caja', 'unit', 'cajas', 'active', true)));
  perform public.erp_sync_apply_lots(run_id, jsonb_build_array(
    jsonb_build_object('externalId', 'L-' || p_suffix, 'productExternalId', 'P-' || p_suffix, 'lotNumber', 'L-' || p_suffix,
                       'expirationDate', '2027-01-31', 'active', true)));
  perform public.erp_sync_apply_stock(run_id, jsonb_build_array(
    jsonb_build_object('productExternalId', 'P-' || p_suffix, 'lotExternalId', 'L-' || p_suffix,
                       'warehouseExternalId', 'Central ' || p_suffix, 'quantity', 40, 'uom', 'Caja', 'unit', 'cajas')));
  perform public.erp_sync_apply_orders(run_id, jsonb_build_array(
    jsonb_build_object('externalId', 'SO-' || p_suffix, 'status', 'pending',
      'customer', jsonb_build_object('externalId', 'CUST-' || p_suffix, 'name', 'Cliente ' || p_suffix),
      'scheduledDate', '2026-11-05',
      'lines', jsonb_build_array(jsonb_build_object('externalId', 'SO-' || p_suffix || '-1', 'productExternalId', 'P-' || p_suffix,
        'quantity', 10, 'uom', 'Caja', 'unit', 'cajas', 'warehouseExternalId', 'Central ' || p_suffix)))));
  return public.erp_sync_finish(run_id, null);
end;
$$;

insert into auth.users (id, email) values
  ('c1041000-0000-0000-0000-0000000000a1', 'trz104-logistica-a@test.local'),
  ('c1041000-0000-0000-0000-0000000000a2', 'trz104-deposito-a@test.local'),
  ('c1041000-0000-0000-0000-0000000000b1', 'trz104-logistica-b@test.local');
insert into companies (id, name) values
  ('c1040000-0000-0000-0000-00000000000a', 'TRZ-104 Empresa A'),
  ('c1040000-0000-0000-0000-00000000000b', 'TRZ-104 Empresa B'),
  ('c1040000-0000-0000-0000-00000000000c', 'TRZ-104 Empresa sin ERP');
insert into users (id, company_id, name, email, role) values
  ('c1041000-0000-0000-0000-0000000000a1', 'c1040000-0000-0000-0000-00000000000a', 'Logística A', 'trz104-logistica-a@test.local', 'logistics_manager'),
  ('c1041000-0000-0000-0000-0000000000a2', 'c1040000-0000-0000-0000-00000000000a', 'Depósito A', 'trz104-deposito-a@test.local', 'warehouse_operator'),
  ('c1041000-0000-0000-0000-0000000000b1', 'c1040000-0000-0000-0000-00000000000b', 'Logística B', 'trz104-logistica-b@test.local', 'logistics_manager');

create temp table trz104_runs (label text, run public.erp_sync_runs);
grant all on trz104_runs to service_role, authenticated;

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_sync_start(uuid, uuid, text)', 'execute'), 'service_role abre ejecuciones');
select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_sync_apply_orders(uuid, jsonb)', 'execute'), 'service_role aplica órdenes');
select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_sync_save_dispatch_documents(uuid, jsonb, jsonb)', 'execute'), 'service_role guarda remitos');
select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_sync_auto_companies()', 'execute'), 'service_role lista empresas');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.erp_sync_auto_companies()', 'execute'), 'un usuario no lista empresas');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_sync_start(uuid, uuid, text)', 'execute'), 'anon no abre ejecuciones');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_sync_apply_stock(uuid, jsonb)', 'execute'), 'anon no aplica stock');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_sync_auto_companies()', 'execute'), 'anon no lista empresas');
select pg_temp.assert_true(not has_function_privilege('service_role', 'public.erp_sync_lock_run(uuid)', 'execute'), 'el helper no se expone');

/* ---------- Manual de A: sigue igual (y deja a A entre las empresas con ERP) ---------- */

set local role authenticated;
select pg_temp.as_user('c1041000-0000-0000-0000-0000000000a1');
insert into trz104_runs select 'manual A', pg_temp.sync('c1040000-0000-0000-0000-00000000000a', auth.uid(), 'A');
reset role;

select pg_temp.assert_true(
  (select (run).status = 'success' and (run).trigger_source = 'manual'
          and (run).triggered_by = 'c1041000-0000-0000-0000-0000000000a1' from trz104_runs where label = 'manual A'),
  'la manual queda atribuida al usuario y con origen manual');

-- B solo tiene un depósito vinculado al ERP (sin sincronizaciones): también cuenta como empresa con ERP.
insert into public.warehouses (company_id, code, name) values
  ('c1040000-0000-0000-0000-00000000000b', 'DEP-01', 'Depósito principal');
insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values
  ('c1040000-0000-0000-0000-00000000000b', 'Central B', 'DEP-01', 'c1041000-0000-0000-0000-0000000000b1');

/* ---------- Empresas que sincroniza el cron ---------- */

set local role service_role;
select pg_temp.as_service();
select pg_temp.assert_true(
  (select array_agg(company_id order by company_id) from public.erp_sync_auto_companies()
   where company_id in ('c1040000-0000-0000-0000-00000000000a', 'c1040000-0000-0000-0000-00000000000b', 'c1040000-0000-0000-0000-00000000000c'))
  = array['c1040000-0000-0000-0000-00000000000a', 'c1040000-0000-0000-0000-00000000000b']::uuid[],
  'el cron sincroniza las empresas con sincronización previa o depósito vinculado, no las demás');
select pg_temp.assert_true(
  (select array_position(array_agg(company_id), 'c1040000-0000-0000-0000-00000000000b')
        < array_position(array_agg(company_id), 'c1040000-0000-0000-0000-00000000000a')
   from public.erp_sync_auto_companies()),
  'primero la que nunca se sincronizó');

/* ---------- Automática de A y de B con service_role ---------- */

insert into trz104_runs select 'auto A', pg_temp.sync('c1040000-0000-0000-0000-00000000000a', null, 'A');
insert into trz104_runs select 'auto B', pg_temp.sync('c1040000-0000-0000-0000-00000000000b', null, 'B');

-- Una automática con usuario no se acepta.
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', 'c1041000-0000-0000-0000-0000000000a1', 'mock');
  raise exception 'TRZ-104: service_role abrió una automática a nombre de un usuario';
exception when invalid_parameter_value then null;
end;
$$;
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-0000000000ff', null, 'mock');
  raise exception 'TRZ-104: service_role abrió una ejecución de una empresa inexistente';
exception when invalid_parameter_value then null;
end;
$$;
reset role;

select pg_temp.assert_true(
  (select bool_and((run).status = 'success' and (run).trigger_source = 'automatic' and (run).triggered_by is null)
   from trz104_runs where label in ('auto A', 'auto B')),
  'las automáticas de A y B terminan bien, con origen automático y sin usuario');
select pg_temp.assert_true(
  (select count(*) from trz104_runs where label in ('auto A', 'auto B')) = 2,
  'corrieron las dos empresas');
select pg_temp.assert_true(
  (select created_by is null and source_system = 'erp' from dispatch_orders
   where company_id = 'c1040000-0000-0000-0000-00000000000b' and external_id = 'SO-B'),
  'la orden que crea una automática queda sin autor');
select pg_temp.assert_true(
  (select created_by = 'c1041000-0000-0000-0000-0000000000a1' from dispatch_orders
   where company_id = 'c1040000-0000-0000-0000-00000000000a' and external_id = 'SO-A'),
  'la orden creada por la manual conserva su autor');
select pg_temp.assert_true(
  (select b.quantity = 40 from erp_stock_balances b join batches l on l.id = b.batch_id
   where b.company_id = 'c1040000-0000-0000-0000-00000000000b' and l.external_id = 'L-B'),
  'la automática guarda los saldos de B');
select pg_temp.assert_true(
  (select ((run).counters->'orders'->>'unchanged')::int = 1 from trz104_runs where label = 'auto A'),
  'la automática de A no duplica la orden de la manual');

-- Las órdenes manuales siguen exigiendo autor.
do $$
begin
  insert into dispatch_orders (company_id, distributor_id, status)
  select 'c1040000-0000-0000-0000-00000000000a', d.id, 'draft' from distributors d
  where d.company_id = 'c1040000-0000-0000-0000-00000000000a' limit 1;
  raise exception 'TRZ-104: se aceptó una orden manual sin autor';
exception when not_null_violation or check_violation then null;
end;
$$;
-- Una manual sin usuario tampoco.
do $$
begin
  insert into erp_sync_runs (company_id, provider) values ('c1040000-0000-0000-0000-00000000000a', 'mock');
  raise exception 'TRZ-104: se aceptó una sincronización manual sin usuario';
exception when check_violation then null;
end;
$$;

/* ---------- Una sola ejecución por empresa ---------- */

set local role service_role;
select pg_temp.as_service();
select set_config('test.running', public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', null, 'mock')::text, true);
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', null, 'mock');
  raise exception 'TRZ-104: se abrieron dos automáticas a la vez para la misma empresa';
exception when lock_not_available then null;
end;
$$;
reset role;

set local role authenticated;
select pg_temp.as_user('c1041000-0000-0000-0000-0000000000a1');
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', auth.uid(), 'mock');
  raise exception 'TRZ-104: se abrió una manual con una automática en curso';
exception when lock_not_available then null;
end;
$$;
-- Un usuario no puede seguir una automática, aunque sea logística de esa empresa.
do $$
begin
  perform public.erp_sync_finish(current_setting('test.running')::uuid, null);
  raise exception 'TRZ-104: logística cerró una sincronización automática';
exception when insufficient_privilege then null;
end;
$$;
reset role;

set local role service_role;
select pg_temp.as_service();
select pg_temp.assert_true(
  (public.erp_sync_finish(current_setting('test.running')::uuid, 'El ERP no respondió.')).status = 'failed',
  'service_role cierra su automática con la falla auditada');
reset role;

/* ---------- Manual: permisos de siempre ---------- */

set local role authenticated;
select pg_temp.as_user('c1041000-0000-0000-0000-0000000000a1');
select set_config('test.manual', public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', auth.uid(), 'mock')::text, true);
reset role;

-- service_role no puede seguir una manual.
set local role service_role;
select pg_temp.as_service();
do $$
begin
  perform public.erp_sync_apply_products(current_setting('test.manual')::uuid, '[]');
  raise exception 'TRZ-104: service_role siguió una sincronización manual';
exception when insufficient_privilege then null;
end;
$$;
reset role;

set local role authenticated;
-- Depósito de la misma empresa: denegado.
select pg_temp.as_user('c1041000-0000-0000-0000-0000000000a2');
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', auth.uid(), 'mock');
  raise exception 'TRZ-104: un operador de depósito abrió una sincronización';
exception when insufficient_privilege then null;
end;
$$;
-- Logística de otra empresa: denegado.
select pg_temp.as_user('c1041000-0000-0000-0000-0000000000b1');
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-00000000000a', auth.uid(), 'mock');
  raise exception 'TRZ-104: logística de B sincronizó la empresa A';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  perform public.erp_sync_apply_products(current_setting('test.manual')::uuid, '[]');
  raise exception 'TRZ-104: logística de B siguió la manual de A';
exception when insufficient_privilege then null;
end;
$$;
-- Un usuario no puede abrir una sin usuario (haciéndose pasar por el cron).
do $$
begin
  perform public.erp_sync_start('c1040000-0000-0000-0000-00000000000b', null, 'mock');
  raise exception 'TRZ-104: un usuario abrió una sincronización sin actor';
exception when insufficient_privilege then null;
end;
$$;
-- Ni listar las empresas.
do $$
begin
  perform public.erp_sync_auto_companies();
  raise exception 'TRZ-104: un usuario listó las empresas del cron';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('c1041000-0000-0000-0000-0000000000a1');
select pg_temp.assert_true(
  (public.erp_sync_finish(current_setting('test.manual')::uuid, null)).trigger_source = 'manual',
  'quien abrió la manual la puede cerrar');

/* ---------- Integración ERP: muestra cuáles fueron automáticas ---------- */

select pg_temp.assert_true(
  (select count(*) filter (where trigger_source = 'automatic') = 2 and count(*) filter (where trigger_source = 'manual') = 2
   from public.erp_integration_activity('sync', null, null, null, null, 100, 0)),
  'la actividad lista manuales y automáticas de A, con su origen');
select pg_temp.assert_true(
  (select count(*) = 0 from public.erp_integration_activity('dispatch_confirmed', null, null, null, null, 100, 0)
   where trigger_source is not null),
  'los reportes no tienen origen');
select pg_temp.assert_true(
  (select public.erp_integration_event_detail('sync', (run).id)->>'triggerSource' = 'automatic'
          and public.erp_integration_event_detail('sync', (run).id)->>'triggeredByName' is null
   from trz104_runs where label = 'auto A'),
  'el detalle de una automática dice su origen y no tiene usuario');
select pg_temp.assert_true(
  (select public.erp_integration_event_detail('sync', (run).id)->>'triggeredByName' = 'Logística A'
          and public.erp_integration_event_detail('sync', (run).id)->>'triggerSource' = 'manual'
   from trz104_runs where label = 'manual A'),
  'el detalle de una manual sigue mostrando quién la inició');
reset role;

rollback;
