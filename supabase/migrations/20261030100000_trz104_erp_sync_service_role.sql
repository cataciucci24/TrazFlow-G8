-- TRZ-104: sincronización automática con el ERP (cron sin usuario, con service_role).
--
-- Atribución elegida: una sincronización automática no tiene usuario. erp_sync_runs.trigger_source dice si fue
-- manual (logística tocó "Sincronizar") o automática (el cron), y triggered_by queda null en las automáticas.
-- Las órdenes y los vínculos de depósito que crea una automática también quedan sin created_by. Solo la página
-- Integración ERP muestra si una sincronización fue automática (actividad y detalle); el resto de la app no
-- distingue una de otra.
--
-- Permisos: service_role puede abrir y seguir una sincronización automática de cualquier empresa. Un usuario
-- autenticado sigue necesitando ser logística de la empresa, y solo sigue las ejecuciones manuales que abrió él.

/* ---------- Origen y atribución ---------- */

alter table public.erp_sync_runs
  add column trigger_source text not null default 'manual' check (trigger_source in ('manual', 'automatic')),
  alter column triggered_by drop not null,
  add constraint erp_sync_runs_trigger_check check ((trigger_source = 'manual') = (triggered_by is not null));

-- Solo las órdenes importadas del ERP pueden no tener autor (las crea una sincronización automática). Las
-- órdenes manuales siguen exigiendo created_by.
alter table public.dispatch_orders
  alter column created_by drop not null,
  add constraint dispatch_orders_created_by_check check (created_by is not null or source_system = 'erp');

-- Los vínculos de depósito solo los crea la sincronización (TRZ-101); en una automática no hay usuario.
alter table public.erp_warehouse_mappings alter column created_by drop not null;

/* ---------- Seguimiento de una ejecución ---------- */

-- Bloquea la ejecución y verifica quién la sigue: service_role solo las automáticas; un usuario, solo las
-- manuales que abrió él, con rol y empresa vigentes.
create or replace function public.erp_sync_lock_run(p_run_id uuid)
returns public.erp_sync_runs language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs;
begin
  select * into run from public.erp_sync_runs where id = p_run_id for update;
  if not found then
    raise exception 'No tenés permisos sobre esta sincronización.' using errcode = '42501';
  end if;
  if (select auth.role()) = 'service_role' then
    if run.trigger_source <> 'automatic' then
      raise exception 'No tenés permisos sobre esta sincronización.' using errcode = '42501';
    end if;
  elsif auth.uid() is null or run.trigger_source <> 'manual' or run.triggered_by is distinct from auth.uid()
     or public.auth_role() is distinct from 'logistics_manager'
     or public.auth_company_id() is distinct from run.company_id then
    raise exception 'No tenés permisos sobre esta sincronización.' using errcode = '42501';
  end if;
  if run.status <> 'running' then
    raise exception 'La sincronización ya terminó.' using errcode = '55000';
  end if;
  return run;
end;
$$;

revoke all on function public.erp_sync_lock_run(uuid) from public, anon, authenticated, service_role;

/* ---------- Inicio ---------- */

-- Abre una ejecución.
--   * Usuario (manual): p_actor_id tiene que ser el usuario de la sesión, logística de la empresa.
--   * service_role (automática): p_actor_id tiene que ser null; la empresa tiene que existir.
-- Una sola ejecución por empresa a la vez, sea manual o automática.
create or replace function public.erp_sync_start(p_company_id uuid, p_actor_id uuid, p_provider text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  run_id uuid;
  v_source text;
begin
  if (select auth.role()) = 'service_role' then
    if p_actor_id is not null then
      raise exception 'Una sincronización automática no tiene usuario.' using errcode = '22023';
    end if;
    if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then
      raise exception 'Empresa inexistente.' using errcode = '22023';
    end if;
    v_source := 'automatic';
  else
    if auth.uid() is null or auth.uid() is distinct from p_actor_id
       or public.auth_role() is distinct from 'logistics_manager'
       or public.auth_company_id() is distinct from p_company_id then
      raise exception 'Solo logística de la empresa puede sincronizar con el ERP.' using errcode = '42501';
    end if;
    v_source := 'manual';
  end if;
  if p_provider is null or length(btrim(p_provider)) not between 1 and 40 then
    raise exception 'Proveedor ERP inválido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp_sync:' || p_company_id::text, 0));
  update public.erp_sync_runs
  set status = 'failed', finished_at = now(),
      error_message = 'La ejecución quedó interrumpida y se cerró automáticamente.'
  where company_id = p_company_id and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from public.erp_sync_runs where company_id = p_company_id and status = 'running') then
    raise exception 'Ya hay una sincronización con el ERP en curso para tu empresa.' using errcode = '55P03';
  end if;

  insert into public.erp_sync_runs (company_id, triggered_by, provider, trigger_source)
  values (p_company_id, p_actor_id, btrim(p_provider), v_source)
  returning id into run_id;
  return run_id;
end;
$$;

/* ---------- Empresas a sincronizar ---------- */

-- Mientras isErpEnabled sea global, el cron sincroniza las empresas que ya trabajan con el ERP: las que tienen
-- al menos una sincronización previa o un depósito vinculado al ERP. Primero las que hace más que no se
-- sincronizan (o nunca): si la corrida se corta por tiempo, las que quedaron afuera van primero la próxima vez.
create function public.erp_sync_auto_companies()
returns table (company_id uuid, last_started_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Solo el servidor puede listar las empresas a sincronizar.' using errcode = '42501';
  end if;
  return query
  select company.id, (select max(run.started_at) from public.erp_sync_runs run where run.company_id = company.id)
  from public.companies company
  where exists (select 1 from public.erp_sync_runs run where run.company_id = company.id)
     or exists (select 1 from public.erp_warehouse_mappings mapping where mapping.company_id = company.id)
  order by 2 nulls first, company.id;
end;
$$;

revoke all on function public.erp_sync_auto_companies() from public, anon, authenticated;
grant execute on function public.erp_sync_auto_companies() to service_role;

/* ---------- Grants para service_role ---------- */

grant execute on function public.erp_sync_start(uuid, uuid, text) to service_role;
grant execute on function public.erp_sync_finish(uuid, text) to service_role;
grant execute on function public.erp_sync_apply_warehouses(uuid, jsonb) to service_role;
grant execute on function public.erp_sync_apply_products(uuid, jsonb) to service_role;
grant execute on function public.erp_sync_apply_lots(uuid, jsonb) to service_role;
grant execute on function public.erp_sync_apply_stock(uuid, jsonb) to service_role;
grant execute on function public.erp_sync_apply_orders(uuid, jsonb) to service_role;
grant execute on function public.erp_sync_save_dispatch_documents(uuid, jsonb, jsonb) to service_role;

/* ---------- Integración ERP: origen de cada sincronización ---------- */

-- Igual que en 20261028100300_trz100_erp_stock_cap.sql, más trigger_source (null en los reportes).
drop function public.erp_integration_activity(text, text, timestamptz, timestamptz, text, integer, integer);
create function public.erp_integration_activity(
  p_kind text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  kind text,
  id uuid,
  status text,
  occurred_at timestamptz,
  finished_at timestamptz,
  attempts integer,
  next_attempt_at timestamptz,
  error_code text,
  error_message text,
  error_count integer,
  order_id uuid,
  order_external_id text,
  pallet_count integer,
  erp_reference text,
  provider text,
  erp_document_status text,
  trigger_source text,
  total_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
  v_search text := nullif(btrim(p_search), '');
  v_pattern text;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede consultar la integración con el ERP.' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('sync', 'dispatch_confirmed') then
    raise exception 'Tipo de evento inválido: %.', p_kind using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('running', 'success', 'partial', 'failed', 'pending', 'processing', 'sent') then
    raise exception 'Estado inválido: %.', p_status using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'El rango de fechas es inválido.' using errcode = '22023';
  end if;
  if v_search is not null and length(v_search) > 100 then
    raise exception 'La búsqueda admite hasta 100 caracteres.' using errcode = '22023';
  end if;
  v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with activity as (
    select
      'sync'::text as kind, run.id, run.status, run.started_at as occurred_at, run.finished_at,
      null::integer as attempts, null::timestamptz as next_attempt_at, null::text as error_code,
      run.error_message, jsonb_array_length(run.errors) as error_count,
      null::uuid as order_id, null::text as order_external_id, null::integer as pallet_count,
      null::text as erp_reference, run.provider, null::text as erp_document_status,
      run.trigger_source
    from public.erp_sync_runs run
    where run.company_id = v_company
      and (p_kind is null or p_kind = 'sync')
      and (v_search is null or exists (
        select 1 from jsonb_array_elements(run.errors) err where err->>'external_id' ilike v_pattern))
    union all
    select
      event.event_type, event.id, event.status, event.created_at, event.sent_at,
      event.attempts, event.next_attempt_at, event.last_error_code,
      event.last_error, case when event.last_error is null then 0 else 1 end,
      event.aggregate_id, coalesce(orders.external_id, event.payload->>'orderExternalId'),
      jsonb_array_length(coalesce(event.payload->'lines', '[]'::jsonb)),
      event.erp_reference, null::text, event.erp_document_status,
      null::text
    from public.erp_outbox_events event
    left join public.dispatch_orders orders
      on orders.id = event.aggregate_id and orders.company_id = event.company_id
    where event.company_id = v_company
      and (p_kind is null or p_kind = event.event_type)
      and (v_search is null
        or orders.external_id ilike v_pattern
        or event.payload->>'orderExternalId' ilike v_pattern
        or exists (
          select 1
          from jsonb_array_elements(coalesce(event.payload->'lines', '[]'::jsonb)) line
          left join public.pallets pallet
            on pallet.qr_code = line->>'palletCode' and pallet.company_id = event.company_id
          where line->>'palletCode' ilike v_pattern
             or line->>'lotExternalId' ilike v_pattern
             or pallet.external_id ilike v_pattern))
  )
  select
    a.kind, a.id, a.status, a.occurred_at, a.finished_at, a.attempts, a.next_attempt_at, a.error_code,
    a.error_message, a.error_count, a.order_id, a.order_external_id, a.pallet_count, a.erp_reference,
    a.provider, a.erp_document_status, a.trigger_source, count(*) over ()
  from activity a
  where (p_status is null or a.status = p_status)
    and (p_from is null or a.occurred_at >= p_from)
    and (p_to is null or a.occurred_at < p_to)
  order by a.occurred_at desc, a.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.erp_integration_activity(text, text, timestamptz, timestamptz, text, integer, integer) from public, anon;
grant execute on function public.erp_integration_activity(text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;

-- Igual que en 20261028100300_trz100_erp_stock_cap.sql, más triggerSource en el detalle de una sincronización.
create or replace function public.erp_integration_event_detail(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
  v_result jsonb;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede consultar la integración con el ERP.' using errcode = '42501';
  end if;

  if p_kind = 'sync' then
    select jsonb_build_object(
      'kind', 'sync', 'id', run.id, 'status', run.status, 'provider', run.provider,
      'startedAt', run.started_at, 'finishedAt', run.finished_at,
      'errorMessage', run.error_message, 'counters', run.counters, 'errors', run.errors,
      'triggeredByName', actor.name, 'triggerSource', run.trigger_source)
    into v_result
    from public.erp_sync_runs run
    left join public.users actor on actor.id = run.triggered_by
    where run.id = p_id and run.company_id = v_company;
  elsif p_kind = 'dispatch_confirmed' then
    select jsonb_build_object(
      'kind', event.event_type, 'id', event.id, 'status', event.status, 'attempts', event.attempts,
      'createdAt', event.created_at, 'lastAttemptAt', event.last_attempt_at,
      'nextAttemptAt', event.next_attempt_at, 'sentAt', event.sent_at,
      'errorCode', event.last_error_code, 'errorMessage', event.last_error,
      'erpReference', event.erp_reference, 'erpDuplicate', event.erp_duplicate,
      'erpDocumentStatus', event.erp_document_status,
      'erpDocumentCheckedAt', event.erp_document_checked_at,
      'erpDocumentConfirmedSeenAt', event.erp_document_confirmed_seen_at,
      'order', jsonb_build_object(
        'id', event.aggregate_id,
        'externalId', coalesce(orders.external_id, event.payload->>'orderExternalId'),
        'status', orders.status),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'palletCode', line->>'palletCode',
            'orderLineExternalId', line->>'orderLineExternalId',
            'productExternalId', line->>'productExternalId',
            'lotExternalId', line->>'lotExternalId',
            'quantity', line->'quantity',
            'uom', line->>'uom') order by line->>'palletCode')
        from jsonb_array_elements(coalesce(event.payload->'lines', '[]'::jsonb)) line), '[]'::jsonb),
      'retries', coalesce((
        select jsonb_agg(jsonb_build_object(
            'requestedAt', retry.requested_at, 'requestedByName', requester.name,
            'previousAttempts', retry.previous_attempts, 'previousErrorCode', retry.previous_error_code,
            'previousError', retry.previous_error) order by retry.requested_at desc)
        from public.erp_outbox_retry_requests retry
        left join public.users requester on requester.id = retry.requested_by
        where retry.event_id = event.id), '[]'::jsonb))
    into v_result
    from public.erp_outbox_events event
    left join public.dispatch_orders orders
      on orders.id = event.aggregate_id and orders.company_id = event.company_id
    where event.id = p_id and event.company_id = v_company;
  else
    raise exception 'Tipo de evento inválido: %.', p_kind using errcode = '22023';
  end if;

  return v_result;
end;
$$;
