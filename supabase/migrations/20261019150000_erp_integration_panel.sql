-- US-ERP-05: panel operativo de integración ERP (/dashboard/integrations).
--
-- Lecturas: funciones SECURITY INVOKER (la RLS de erp_sync_runs, erp_outbox_events y dispatch_orders se
-- aplica sobre la sesión) que además exigen el rol logistics_manager. Devuelven solo columnas seguras:
-- nunca el payload completo, la clave de idempotencia ni los datos del operador.
--
-- Escritura: erp_outbox_retry_failed (SECURITY DEFINER) vuelve un reporte `failed` a `pending` y deja
-- registro en erp_outbox_retry_requests. No toca el payload ni crea otro evento (el trigger
-- guard_erp_outbox_event de US-ERP-04 también lo impide). El intento se suma cuando el procesador vuelve a
-- tomar el evento (erp_outbox_claim): un reporte con los intentos agotados recibe exactamente un envío más
-- y, si falla, vuelve a `failed`.
--
-- No modifica erp_outbox_requeue ni la RLS de erp_outbox_events (US-ERP-04).

/* ---------- Auditoría de reintentos manuales ---------- */

create table public.erp_outbox_retry_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  event_id uuid not null references public.erp_outbox_events(id) on delete restrict,
  requested_by uuid not null references public.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  -- Cómo estaba el evento al pedir el reintento (siempre `failed`).
  previous_status text not null check (previous_status = 'failed'),
  previous_attempts integer not null check (previous_attempts >= 0),
  previous_error_code text check (previous_error_code is null or length(previous_error_code) <= 40),
  previous_error text check (previous_error is null or length(previous_error) <= 500)
);
create index idx_erp_outbox_retry_requests_event on public.erp_outbox_retry_requests(event_id, requested_at desc);
create index idx_erp_outbox_retry_requests_company on public.erp_outbox_retry_requests(company_id, requested_at desc);

alter table public.erp_outbox_retry_requests enable row level security;
revoke all on public.erp_outbox_retry_requests from anon, authenticated, service_role;
grant select on public.erp_outbox_retry_requests to authenticated;
create policy erp_outbox_retry_requests_select on public.erp_outbox_retry_requests for select to authenticated
  using (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager');

/* ---------- Reintento manual ---------- */

-- Devuelve la orden del evento (aggregate_id) para que el servidor lo procese enseguida, fuera de esta
-- transacción. Un evento de otra empresa responde igual que uno inexistente.
create function public.erp_outbox_retry_failed(p_event_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
  v_event public.erp_outbox_events;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede reintentar reportes al ERP.' using errcode = '42501';
  end if;

  select * into v_event from public.erp_outbox_events
    where id = p_event_id and company_id = v_company
    for update;
  if not found then
    raise exception 'El reporte no existe o no pertenece a tu empresa.' using errcode = 'P0002';
  end if;
  if v_event.status <> 'failed' then
    raise exception 'Solo se pueden reintentar reportes fallidos (estado actual: %).', v_event.status using errcode = '55000';
  end if;

  update public.erp_outbox_events set status = 'pending', next_attempt_at = now() where id = v_event.id;

  insert into public.erp_outbox_retry_requests
    (company_id, event_id, requested_by, previous_status, previous_attempts, previous_error_code, previous_error)
  values
    (v_company, v_event.id, auth.uid(), v_event.status, v_event.attempts, v_event.last_error_code, v_event.last_error);

  return v_event.aggregate_id;
end;
$$;

revoke all on function public.erp_outbox_retry_failed(uuid) from public, anon, service_role;
grant execute on function public.erp_outbox_retry_failed(uuid) to authenticated;

/* ---------- Lecturas del panel (SECURITY INVOKER) ---------- */

-- Actividad unificada: ejecuciones de sincronización (kind 'sync') y reportes del outbox (kind = event_type),
-- más recientes primero. Filtros opcionales; p_to es exclusivo. total_count = filas que cumplen los filtros.
-- p_search busca (sin distinguir mayúsculas) en la orden externa, el QR / external_id / lote de los pallets
-- del reporte y el external_id de los errores de una sincronización.
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
      null::text as erp_reference, run.provider
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
      event.erp_reference, null::text
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
    a.provider, count(*) over ()
  from activity a
  where (p_status is null or a.status = p_status)
    and (p_from is null or a.occurred_at >= p_from)
    and (p_to is null or a.occurred_at < p_to)
  order by a.occurred_at desc, a.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Resumen para el estado general del panel.
create function public.erp_integration_summary()
returns table (
  pending_count bigint,
  processing_count bigint,
  failed_count bigint,
  sent_count bigint,
  oldest_pending_at timestamptz,
  running_sync_count bigint,
  last_run_id uuid,
  last_run_status text,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_success_at timestamptz,
  unreported_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede consultar la integración con el ERP.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.erp_outbox_events e where e.company_id = v_company and e.status = 'pending'),
    (select count(*) from public.erp_outbox_events e where e.company_id = v_company and e.status = 'processing'),
    (select count(*) from public.erp_outbox_events e where e.company_id = v_company and e.status = 'failed'),
    (select count(*) from public.erp_outbox_events e where e.company_id = v_company and e.status = 'sent'),
    (select min(e.created_at) from public.erp_outbox_events e where e.company_id = v_company and e.status = 'pending'),
    (select count(*) from public.erp_sync_runs r where r.company_id = v_company and r.status = 'running'),
    last_run.id, last_run.status, last_run.started_at, last_run.finished_at,
    (select max(r.finished_at) from public.erp_sync_runs r where r.company_id = v_company and r.status = 'success'),
    (select count(*)
       from public.dispatch_orders o
       left join public.erp_outbox_events e
         on e.event_type = 'dispatch_confirmed' and e.aggregate_id = o.id and e.company_id = o.company_id
      where o.company_id = v_company and o.external_id is not null and o.confirmed_at is not null
        and (e.id is null or e.status <> 'sent'))
  from (select 1) one
  left join lateral (
    select r.id, r.status, r.started_at, r.finished_at from public.erp_sync_runs r
    where r.company_id = v_company order by r.started_at desc limit 1
  ) last_run on true;
end;
$$;

-- Órdenes del ERP despachadas físicamente (confirmed_at) cuyo reporte todavía no llegó al ERP: el evento
-- está pending / processing / failed, o directamente no existe (event_status = 'missing').
create function public.erp_dispatched_unreported(p_limit integer default 20, p_offset integer default 0)
returns table (
  order_id uuid,
  order_external_id text,
  order_status text,
  confirmed_at timestamptz,
  distributor_name text,
  event_id uuid,
  event_status text,
  attempts integer,
  last_error_code text,
  next_attempt_at timestamptz,
  total_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede consultar la integración con el ERP.' using errcode = '42501';
  end if;

  return query
  select
    o.id, o.external_id, o.status::text, o.confirmed_at, d.name,
    e.id, coalesce(e.status, 'missing'), e.attempts, e.last_error_code, e.next_attempt_at,
    count(*) over ()
  from public.dispatch_orders o
  left join public.distributors d on d.id = o.distributor_id
  left join public.erp_outbox_events e
    on e.event_type = 'dispatch_confirmed' and e.aggregate_id = o.id and e.company_id = o.company_id
  where o.company_id = v_company and o.external_id is not null and o.confirmed_at is not null
    and (e.id is null or e.status <> 'sent')
  order by o.confirmed_at asc, o.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Detalle de un evento del panel, o null si no existe o no es visible. Del payload solo se exponen las
-- líneas (pallet, producto, lote, cantidad, unidad): ni el operador ni la clave de idempotencia.
create function public.erp_integration_event_detail(p_kind text, p_id uuid)
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
      'triggeredByName', actor.name)
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
      'order', jsonb_build_object(
        'id', event.aggregate_id,
        'externalId', coalesce(orders.external_id, event.payload->>'orderExternalId'),
        'status', orders.status),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'palletCode', line->>'palletCode',
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

revoke all on function public.erp_integration_activity(text, text, timestamptz, timestamptz, text, integer, integer) from public, anon;
revoke all on function public.erp_integration_summary() from public, anon;
revoke all on function public.erp_dispatched_unreported(integer, integer) from public, anon;
revoke all on function public.erp_integration_event_detail(text, uuid) from public, anon;
grant execute on function public.erp_integration_activity(text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.erp_integration_summary() to authenticated;
grant execute on function public.erp_dispatched_unreported(integer, integer) to authenticated;
grant execute on function public.erp_integration_event_detail(text, uuid) to authenticated;
