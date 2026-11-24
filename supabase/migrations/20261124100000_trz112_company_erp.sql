-- TRZ-112 (1/2): cada empresa tiene su propio ERP.
--
-- Hasta acá el ERP era uno solo para toda la instalación (variables ERP_* del servidor). Ahora:
--
--   * erp_company_settings (TRZ-65) suma la conexión de la empresa SIN secretos: proveedor, URL, base y usuario de
--     Odoo, timeout, Item Group y las últimas 4 letras de cada credencial (para mostrarlas enmascaradas).
--     Sin proveedor (erp_provider null), la empresa trabaja en modo manual, como antes sin ERP_PROVIDER.
--   * Las credenciales van cifradas en Supabase Vault. erp_company_credentials solo guarda el id del secreto y
--     nadie la lee por la API: la escribe erp_save_company_config (logística de la empresa) y la lee
--     erp_company_connection (solo service_role, el servidor de TrazFlow).
--   * El outbox separa por empresa: la clave de idempotencia es única POR EMPRESA (antes era global y, con
--     `on conflict do nothing`, el reporte de una segunda empresa con el mismo número de orden se descartaba sin
--     avisar). erp_outbox_claim devuelve la empresa de cada evento y acepta p_company_id, para que el procesador
--     use el ERP de esa empresa. erp_outbox_due_companies le dice al cron qué empresas tienen reportes vencidos.
--
-- No cambia ningún payload ni el contractVersion (sigue 1), ni las tablas/RPC de pallets, ni la protección TM111.

/* ---------- 1. Conexión de la empresa (sin secretos) ---------- */

alter table public.erp_company_settings
  add column erp_provider text check (erp_provider in ('mock', 'erpnext', 'odoo')),
  add column erp_base_url text check (erp_base_url is null or (erp_base_url ~ '^https?://[^\s]+$' and length(erp_base_url) <= 500)),
  add column erp_odoo_database text check (erp_odoo_database is null or length(btrim(erp_odoo_database)) between 1 and 200),
  add column erp_odoo_username text check (erp_odoo_username is null or length(btrim(erp_odoo_username)) between 1 and 200),
  add column erp_item_group text check (erp_item_group is null or length(btrim(erp_item_group)) between 1 and 140),
  add column erp_timeout_ms integer check (erp_timeout_ms is null or erp_timeout_ms between 1000 and 60000),
  add column erp_mock_scenario text check (erp_mock_scenario in ('ok', 'timeout', 'unauthorized', 'validation', 'server_error')),
  add column erp_mock_dispatch_status text check (erp_mock_dispatch_status in ('confirmed', 'draft')),
  add column erp_api_key_hint text check (erp_api_key_hint is null or length(erp_api_key_hint) <= 4),
  add column erp_api_secret_hint text check (erp_api_secret_hint is null or length(erp_api_secret_hint) <= 4),
  add column erp_configured_by uuid references public.users(id) on delete set null,
  add column erp_configured_at timestamptz;

alter table public.erp_company_settings add constraint erp_company_settings_connection_check check (
  case erp_provider
    when 'erpnext' then erp_base_url is not null
    when 'odoo' then erp_base_url is not null and erp_odoo_database is not null and erp_odoo_username is not null
    else true
  end
);

comment on column public.erp_company_settings.erp_provider is
  'TRZ-112: ERP de la empresa. null = sin ERP (modo manual). Los secretos están en Vault (erp_company_credentials).';

/* ---------- 2. Credenciales (Vault) ---------- */

create table public.erp_company_credentials (
  company_id uuid primary key references public.companies(id) on delete cascade,
  vault_secret_id uuid not null unique,
  updated_at timestamptz not null default now()
);
alter table public.erp_company_credentials enable row level security;
-- Sin policies ni grants: solo las funciones SECURITY DEFINER de abajo la tocan.
revoke all on public.erp_company_credentials from public, anon, authenticated, service_role;

-- Guarda la conexión de la empresa de quien llama. Solo logística. Credenciales:
--   * Se cifran en Vault como JSON {"apiKey", "apiSecret"}; nunca se devuelven.
--   * Vacías = conservar las guardadas, pero SOLO si el proveedor y la URL no cambian: así nadie puede apuntar la
--     URL a otro servidor y hacer que TrazFlow le mande la credencial guardada.
--   * p_provider null desactiva el ERP de la empresa y borra el secreto.
create function public.erp_save_company_config(
  p_provider text,
  p_base_url text default null,
  p_odoo_database text default null,
  p_odoo_username text default null,
  p_item_group text default null,
  p_timeout_ms integer default null,
  p_mock_scenario text default null,
  p_mock_dispatch_status text default null,
  p_api_key text default null,
  p_api_secret text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
  v_previous public.erp_company_settings;
  v_secret_id uuid;
  v_stored jsonb;
  v_key text := nullif(btrim(p_api_key), '');
  v_secret text := nullif(btrim(p_api_secret), '');
  v_base_url text := nullif(regexp_replace(btrim(coalesce(p_base_url, '')), '/+$', ''), '');
  v_same_target boolean;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede configurar el ERP de la empresa.' using errcode = '42501';
  end if;
  if p_provider is not null and p_provider not in ('mock', 'erpnext', 'odoo') then
    raise exception 'Proveedor de ERP inválido.' using errcode = '22023';
  end if;

  select * into v_previous from public.erp_company_settings where company_id = v_company for update;
  select credentials.vault_secret_id into v_secret_id
    from public.erp_company_credentials credentials where credentials.company_id = v_company for update;

  -- Desactivar, o un proveedor sin credenciales (mock): no queda ningún secreto guardado.
  if p_provider is null or p_provider = 'mock' then
    if v_secret_id is not null then
      delete from public.erp_company_credentials where company_id = v_company;
      delete from vault.secrets where id = v_secret_id;
    end if;
    v_key := null;
    v_secret := null;
  else
    if v_base_url is null then
      raise exception 'Falta la URL del ERP.' using errcode = '22023';
    end if;
    v_same_target := v_previous.erp_provider is not distinct from p_provider
      and v_previous.erp_base_url is not distinct from v_base_url;
    if v_secret_id is not null and v_same_target then
      select decrypted_secret::jsonb into v_stored from vault.decrypted_secrets where id = v_secret_id;
      v_key := coalesce(v_key, nullif(v_stored->>'apiKey', ''));
      v_secret := coalesce(v_secret, nullif(v_stored->>'apiSecret', ''));
    end if;
    if p_provider = 'odoo' then
      v_secret := null;
    end if;
    if v_key is null or (p_provider = 'erpnext' and v_secret is null) then
      raise exception 'Faltan las credenciales del ERP.' using errcode = '22023';
    end if;

    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        jsonb_build_object('apiKey', v_key, 'apiSecret', v_secret)::text,
        'trazflow_erp_credentials_' || v_company::text,
        'TRZ-112: credenciales del ERP de la empresa'
      );
      insert into public.erp_company_credentials (company_id, vault_secret_id) values (v_company, v_secret_id);
    else
      perform vault.update_secret(v_secret_id, jsonb_build_object('apiKey', v_key, 'apiSecret', v_secret)::text);
      update public.erp_company_credentials set updated_at = now() where company_id = v_company;
    end if;
  end if;

  insert into public.erp_company_settings (company_id, updated_at) values (v_company, now())
  on conflict (company_id) do nothing;

  update public.erp_company_settings
  set erp_provider = p_provider,
      erp_base_url = case when p_provider in ('erpnext', 'odoo') then v_base_url end,
      erp_odoo_database = case when p_provider = 'odoo' then nullif(btrim(p_odoo_database), '') end,
      erp_odoo_username = case when p_provider = 'odoo' then nullif(btrim(p_odoo_username), '') end,
      erp_item_group = case when p_provider = 'erpnext' then nullif(btrim(p_item_group), '') end,
      erp_timeout_ms = case when p_provider in ('erpnext', 'odoo') then p_timeout_ms end,
      erp_mock_scenario = case when p_provider = 'mock' then coalesce(p_mock_scenario, 'ok') end,
      erp_mock_dispatch_status = case when p_provider = 'mock' then coalesce(p_mock_dispatch_status, 'confirmed') end,
      erp_api_key_hint = right(v_key, 4),
      erp_api_secret_hint = right(v_secret, 4),
      erp_configured_by = auth.uid(),
      erp_configured_at = now(),
      updated_at = now()
  where company_id = v_company;
end;
$$;
revoke all on function public.erp_save_company_config(text, text, text, text, text, integer, text, text, text, text) from public, anon, service_role;
grant execute on function public.erp_save_company_config(text, text, text, text, text, integer, text, text, text, text) to authenticated;

-- Proveedor del ERP de una empresa (null = sin ERP). Sin secretos. Cualquier usuario activo puede consultar el de
-- SU empresa (las pantallas deciden si ocultan el alta manual); service_role, el de cualquiera (cron).
create function public.erp_company_provider(p_company_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role'
     and (auth.uid() is null or public.auth_company_id() is distinct from p_company_id) then
    raise exception 'No podés consultar el ERP de otra empresa.' using errcode = '42501';
  end if;
  return (select settings.erp_provider from public.erp_company_settings settings where settings.company_id = p_company_id);
end;
$$;
revoke all on function public.erp_company_provider(uuid) from public, anon;
grant execute on function public.erp_company_provider(uuid) to authenticated, service_role;

-- Conexión completa CON credenciales descifradas, para que el servidor arme el cliente del ERP. Solo service_role:
-- nunca la puede llamar un usuario (ni siquiera logística), así las credenciales no salen hacia el navegador.
create function public.erp_company_connection(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Solo el servidor puede leer la conexión del ERP.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'provider', settings.erp_provider,
      'baseUrl', settings.erp_base_url,
      'odooDatabase', settings.erp_odoo_database,
      'odooUsername', settings.erp_odoo_username,
      'itemGroup', settings.erp_item_group,
      'timeoutMs', settings.erp_timeout_ms,
      'mockScenario', settings.erp_mock_scenario,
      'mockDispatchStatus', settings.erp_mock_dispatch_status,
      'credentials', (
        select secret.decrypted_secret::jsonb
        from public.erp_company_credentials credentials
        join vault.decrypted_secrets secret on secret.id = credentials.vault_secret_id
        where credentials.company_id = settings.company_id))
    from public.erp_company_settings settings
    where settings.company_id = p_company_id and settings.erp_provider is not null
  );
end;
$$;
revoke all on function public.erp_company_connection(uuid) from public, anon, authenticated;
grant execute on function public.erp_company_connection(uuid) to service_role;

/* ---------- 3. Outbox por empresa ---------- */

alter table public.erp_outbox_events drop constraint erp_outbox_events_idempotency_key_key;
alter table public.erp_outbox_events
  add constraint erp_outbox_events_company_idempotency_key_key unique (company_id, idempotency_key);

-- Igual que en 20261102100000_ush1_stock_import.sql, más la empresa de cada evento y p_company_id:
--   * logística / depósito: siempre su empresa (p_company_id null o la propia; otra → 42501).
--   * service_role: p_company_id limita a esa empresa (el cron procesa de a una). null = todas, como antes, para
--     que la versión anterior de la app siga funcionando mientras se despliega esta.
drop function public.erp_outbox_claim(integer, uuid);
create function public.erp_outbox_claim(p_limit integer default 10, p_aggregate_id uuid default null, p_company_id uuid default null)
returns table (id uuid, idempotency_key text, payload jsonb, attempts integer, company_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.erp_outbox_actor_company();
  v_company uuid;
begin
  if v_actor is not null and p_company_id is not null and p_company_id is distinct from v_actor then
    raise exception 'No podés procesar reportes al ERP de otra empresa.' using errcode = '42501';
  end if;
  v_company := coalesce(v_actor, p_company_id);

  -- Un evento que se interrumpió con los intentos ya agotados no se vuelve a tomar.
  update public.erp_outbox_events event
  set status = 'failed', locked_until = null,
      last_error_code = coalesce(event.last_error_code, 'timeout'),
      last_error = 'Se agotaron los reintentos: el último envío se interrumpió sin respuesta.'
  where event.status = 'processing' and event.locked_until < now()
    and event.attempts >= public.erp_outbox_max_attempts()
    and (v_company is null or event.company_id = v_company);

  return query
  with due as (
    select event.id
    from public.erp_outbox_events event
    where (v_company is null or event.company_id = v_company)
      and (p_aggregate_id is null or event.aggregate_id = p_aggregate_id)
      and ((event.status = 'pending' and event.next_attempt_at <= now())
        or (event.status = 'processing' and event.locked_until < now()))
    order by event.event_type = 'stock_import_requested', event.next_attempt_at, event.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.erp_outbox_events event
  set status = 'processing',
      attempts = event.attempts + 1,
      last_attempt_at = now(),
      locked_until = now() + public.erp_outbox_lease()
  from due
  where event.id = due.id
  returning event.id, event.idempotency_key, event.payload, event.attempts, event.company_id;
end;
$$;
revoke all on function public.erp_outbox_claim(integer, uuid, uuid) from public, anon;
grant execute on function public.erp_outbox_claim(integer, uuid, uuid) to authenticated, service_role;

-- Igual que en 20261028130100_trz103_driver_sends_delivery.sql, más la empresa de cada evento.
drop function public.erp_outbox_driver_claim(uuid);
create function public.erp_outbox_driver_claim(p_order_id uuid)
returns table (id uuid, idempotency_key text, payload jsonb, attempts integer, company_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := public.erp_outbox_driver_actor();
begin
  if p_order_id is null then
    raise exception 'Falta la orden.' using errcode = '22023';
  end if;

  return query
  with due as (
    select event.id
    from public.erp_outbox_events event
    where event.event_type in ('delivery_confirmed', 'delivery_receipt_attached')
      and public.erp_outbox_delivery_event_order(event) = p_order_id
      and public.erp_outbox_driver_owns(event, v_driver)
      and event.attempts < public.erp_outbox_max_attempts()
      and ((event.status = 'pending' and event.next_attempt_at <= now())
        or (event.status = 'processing' and event.locked_until < now()))
    order by event.next_attempt_at, event.created_at
    limit 10
    for update skip locked
  )
  update public.erp_outbox_events event
  set status = 'processing',
      attempts = event.attempts + 1,
      last_attempt_at = now(),
      locked_until = now() + public.erp_outbox_lease()
  from due
  where event.id = due.id
  returning event.id, event.idempotency_key, event.payload, event.attempts, event.company_id;
end;
$$;
revoke all on function public.erp_outbox_driver_claim(uuid) from public, anon, service_role;
grant execute on function public.erp_outbox_driver_claim(uuid) to authenticated;

-- Empresas con reportes para enviar ahora (pendientes vencidos o con el lease vencido), la más atrasada primero.
-- La usa el cron (TRZ-104) para procesar empresa por empresa, cada una con su ERP.
create function public.erp_outbox_due_companies()
returns table (company_id uuid, due_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Solo el servidor puede listar las empresas con reportes pendientes.' using errcode = '42501';
  end if;
  return query
  select event.company_id, count(*)
  from public.erp_outbox_events event
  where (event.status = 'pending' and event.next_attempt_at <= now())
     or (event.status = 'processing' and event.locked_until < now())
  group by event.company_id
  order by min(event.next_attempt_at), event.company_id;
end;
$$;
revoke all on function public.erp_outbox_due_companies() from public, anon, authenticated;
grant execute on function public.erp_outbox_due_companies() to service_role;
