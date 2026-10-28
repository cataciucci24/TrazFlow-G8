-- TRZ-104: jobs de pg_cron que llaman a /api/cron/* con la URL y el secreto de Vault.
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final
-- (las requests encoladas en la transacción nunca llegan a pg_net).
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-104 pg_cron: %', message; end if;
end;
$$;

/* ---------- Jobs ---------- */

select pg_temp.assert_true(
  exists (select 1 from cron.job where jobname = 'trazflow-erp-outbox' and schedule = '*/5 * * * *' and active
          and command like '%trazflow_cron_request(''/api/cron/erp-outbox'')%'),
  'job del outbox cada 5 minutos');
select pg_temp.assert_true(
  exists (select 1 from cron.job where jobname = 'trazflow-erp-sync' and schedule = '2,17,32,47 * * * *' and active
          and command like '%trazflow_cron_request(''/api/cron/erp-sync'')%'),
  'job de sincronización cada 15 minutos');
select pg_temp.assert_true(
  (select count(*) from cron.job where jobname like 'trazflow-%') = 2, 'solo dos jobs de TrazFlow');
select pg_temp.assert_true(
  not exists (select 1 from cron.job where jobname like 'trazflow-%' and (command ilike '%bearer%' or command ilike '%http%')),
  'los jobs no llevan URL ni secreto');

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(not has_function_privilege('anon', 'public.trazflow_cron_request(text)', 'execute'), 'anon no la ejecuta');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.trazflow_cron_request(text)', 'execute'), 'authenticated no la ejecuta');
select pg_temp.assert_true(not has_function_privilege('service_role', 'public.trazflow_cron_request(text)', 'execute'), 'service_role no la ejecuta');
select pg_temp.assert_true(
  (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.trazflow_cron_request(text)'::regprocedure),
  'security definer con search_path vacío');

/* ---------- Sin secretos no encola nada ---------- */

delete from vault.secrets where name in ('trazflow_app_url', 'trazflow_cron_secret');
create temp table trz104_queue_before as select coalesce(max(id), 0) as max_id from net.http_request_queue;

select pg_temp.assert_true(public.trazflow_cron_request('/api/cron/erp-outbox') is null, 'sin secretos devuelve null');

select vault.create_secret('https://trz104.example.test/', 'trazflow_app_url', 'test TRZ-104');
select pg_temp.assert_true(public.trazflow_cron_request('/api/cron/erp-sync') is null, 'sin secreto de cron devuelve null');

select vault.create_secret('   ', 'trazflow_cron_secret', 'test TRZ-104');
select pg_temp.assert_true(public.trazflow_cron_request('/api/cron/erp-sync') is null, 'secreto en blanco devuelve null');

select pg_temp.assert_true(
  not exists (select 1 from net.http_request_queue where id > (select max_id from trz104_queue_before)),
  'sin secretos completos no hay requests encoladas');

/* ---------- Con secretos encola la llamada con el Bearer ---------- */

select vault.update_secret((select id from vault.secrets where name = 'trazflow_cron_secret'), 'secreto-de-prueba-trz104');

create temp table trz104_ids as
select public.trazflow_cron_request('/api/cron/erp-outbox') as outbox_id,
       public.trazflow_cron_request('/api/cron/erp-sync') as sync_id;

select pg_temp.assert_true(
  exists (select 1 from net.http_request_queue q join trz104_ids i on q.id = i.outbox_id
          where q.method = 'GET' and q.url = 'https://trz104.example.test/api/cron/erp-outbox'
            and q.headers ->> 'Authorization' = 'Bearer secreto-de-prueba-trz104'
            and q.timeout_milliseconds = 290000),
  'encola el outbox con la URL sin barra doble, el Bearer y el timeout');
select pg_temp.assert_true(
  exists (select 1 from net.http_request_queue q join trz104_ids i on q.id = i.sync_id
          where q.url = 'https://trz104.example.test/api/cron/erp-sync'),
  'encola la sincronización');
select pg_temp.assert_true(
  not exists (select 1 from net.http_request_queue q join trz104_ids i on q.id in (i.outbox_id, i.sync_id)
              where q.headers ? 'x-vercel-protection-bypass'),
  'sin secreto de bypass no manda el header de Vercel');

/* ---------- Bypass de Deployment Protection (opcional) ---------- */

delete from vault.secrets where name = 'trazflow_vercel_bypass';
select vault.create_secret('bypass-de-prueba-trz104', 'trazflow_vercel_bypass', 'test TRZ-104');

create temp table trz104_bypass_id as
select public.trazflow_cron_request('/api/cron/erp-outbox') as id;

select pg_temp.assert_true(
  exists (select 1 from net.http_request_queue q join trz104_bypass_id i on q.id = i.id
          where q.headers ->> 'x-vercel-protection-bypass' = 'bypass-de-prueba-trz104'
            and q.headers ->> 'Authorization' = 'Bearer secreto-de-prueba-trz104'),
  'con secreto de bypass manda el header de Vercel y el Bearer');

/* ---------- Rutas no permitidas ---------- */

do $$
begin
  perform public.trazflow_cron_request('/api/otra-cosa');
  raise exception 'TRZ-104 pg_cron: aceptó una ruta no permitida';
exception when sqlstate '22023' then null;
end;
$$;

rollback;
