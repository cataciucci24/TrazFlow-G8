-- TRZ-104: pg_cron llama cada pocos minutos a los Route Handlers /api/cron/* de la app (pg_net + Bearer).
--
-- La URL de la app y el CRON_SECRET NO están en este archivo: se leen de Vault en cada ejecución
-- (secretos `trazflow_app_url` y `trazflow_cron_secret`, se cargan a mano; ver docs/erp-integration-panel.md).
-- Si falta alguno, el job no hace nada: así la base local, sin secretos, no genera errores cada 5 minutos.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Encola una llamada GET a la app. Devuelve el id de pg_net, o null si faltan los secretos.
-- Solo la usa pg_cron (corre como el dueño de los jobs); nadie de la API puede ejecutarla.
create or replace function public.trazflow_cron_request(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_path is null or p_path not in ('/api/cron/erp-outbox', '/api/cron/erp-sync') then
    raise exception 'Ruta de cron no permitida' using errcode = '22023';
  end if;

  select nullif(btrim(decrypted_secret), '') into v_url
  from vault.decrypted_secrets where name = 'trazflow_app_url' limit 1;
  select nullif(btrim(decrypted_secret), '') into v_secret
  from vault.decrypted_secrets where name = 'trazflow_cron_secret' limit 1;

  if v_url is null or v_secret is null then
    return null;
  end if;

  -- pg_net corta a los 5 s por defecto: se le da casi todo el maxDuration de la función (300 s).
  return net.http_get(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 290000
  );
end;
$$;

revoke all on function public.trazflow_cron_request(text) from public, anon, authenticated, service_role;

-- cron.schedule con un nombre existente reemplaza el job, así que la migración es idempotente.
-- La sincronización corre en los minutos 2, 17, 32 y 47 para no coincidir con el outbox.
select cron.schedule('trazflow-erp-outbox', '*/5 * * * *',
  $job$select public.trazflow_cron_request('/api/cron/erp-outbox');$job$);
select cron.schedule('trazflow-erp-sync', '2,17,32,47 * * * *',
  $job$select public.trazflow_cron_request('/api/cron/erp-sync');$job$);
