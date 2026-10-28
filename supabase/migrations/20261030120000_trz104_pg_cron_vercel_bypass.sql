-- TRZ-104: los deploys de preview (por ejemplo `develop`) tienen Deployment Protection de Vercel y responden
-- 302 a su login antes de llegar a la app. Si Vault tiene el secreto opcional `trazflow_vercel_bypass`
-- (Protection Bypass for Automation del proyecto en Vercel), la llamada lo manda en el header
-- `x-vercel-protection-bypass`. Sin ese secreto (producción, base local) la llamada queda igual que antes.
-- Ningún valor real va en este archivo.

create or replace function public.trazflow_cron_request(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_bypass text;
  v_headers jsonb;
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

  select nullif(btrim(decrypted_secret), '') into v_bypass
  from vault.decrypted_secrets where name = 'trazflow_vercel_bypass' limit 1;

  v_headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret);
  if v_bypass is not null then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  -- pg_net corta a los 5 s por defecto: se le da casi todo el maxDuration de la función (300 s).
  return net.http_get(
    url := rtrim(v_url, '/') || p_path,
    headers := v_headers,
    timeout_milliseconds := 290000
  );
end;
$$;

revoke all on function public.trazflow_cron_request(text) from public, anon, authenticated, service_role;
