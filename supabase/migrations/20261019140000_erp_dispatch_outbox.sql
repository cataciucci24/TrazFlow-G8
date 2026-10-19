-- US-ERP-04: reportar al ERP el despacho confirmado mediante un outbox transaccional.
--
-- Al confirmar el despacho de una orden que vino del ERP, confirm_dispatch_order deja en
-- erp_outbox_events, dentro de la misma transacción que el cambio de estado de la orden y los pallets,
-- el reporte con qué pallet y qué lote salió. Lo envía después un procesador del servidor
-- (src/lib/erp-outbox), siempre fuera de cualquier transacción de base:
--
--   erp_outbox_claim → ErpClient.reportDispatch(payload) → erp_outbox_mark_sent | erp_outbox_mark_failed
--
-- TrazFlow no calcula FIFO ni toca stock: solo informa lo que salió físicamente. Si el ERP falla, el
-- despacho físico queda confirmado igual y el reporte se reintenta con backoff, siempre con el mismo
-- payload y la misma clave de idempotencia (dispatch:{orderExternalId}).

/* ---------- Unidad del ERP en los productos importados ---------- */

-- El reporte tiene que informar la unidad tal como la nombra el ERP ("Caja", "Kg", "Nos"...), no la de
-- TrazFlow. La sincronización ya la recibe (uom); ahora además la guarda.
alter table public.products add column external_uom text;
alter table public.products
  add constraint products_external_uom_check
    check (external_uom is null or (source_system = 'erp' and length(btrim(external_uom)) between 1 and 60));

drop trigger trg_products_guard_erp on public.products;
create trigger trg_products_guard_erp before insert or update or delete on public.products
  for each row execute function public.guard_erp_synced_row('sku', 'name', 'unit_of_measure', 'external_uom');

-- Igual que en 20261019120100_erp_sync_rpcs.sql, más external_uom.
create or replace function public.erp_sync_apply_products(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"failed":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  rec jsonb;
  ext text;
  existing public.products;
  v_sku text;
  v_name text;
  v_unit text;
  v_uom text;
  v_active boolean;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba una lista de productos.' using errcode = '22023';
  end if;

  for rec in select value from jsonb_array_elements(p_records) loop
    counters := public.erp_sync_bump(counters, 'received');
    ext := nullif(btrim(rec->>'externalId'), '');
    begin
      if ext is null then raise exception 'El producto no trae externalId.'; end if;
      if ext = any(seen) then raise exception 'El externalId viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;
      v_sku := nullif(btrim(rec->>'sku'), '');
      v_name := nullif(btrim(rec->>'name'), '');
      v_unit := rec->>'unit';
      v_uom := nullif(btrim(rec->>'uom'), '');
      v_active := coalesce((rec->>'active')::boolean, true);
      if v_sku is null or v_name is null then raise exception 'El producto no trae sku o nombre.'; end if;
      if v_unit is null then
        raise exception 'La unidad "%" del ERP no tiene equivalente en TrazFlow.', rec->>'uom';
      end if;

      select * into existing from public.products
        where company_id = run.company_id and external_id = ext for update;
      if not found then
        insert into public.products (company_id, sku, name, unit_of_measure, external_uom, external_id, source_system, synced_at, external_active)
        values (run.company_id, v_sku, v_name, v_unit, v_uom, ext, 'erp', now(), v_active);
        outcome := 'created';
      elsif (existing.sku, existing.name, existing.unit_of_measure, existing.external_uom, existing.external_active)
            is distinct from (v_sku, v_name, v_unit, v_uom, v_active) then
        update public.products
        set sku = v_sku, name = v_name, unit_of_measure = v_unit, external_uom = v_uom,
            external_active = v_active, synced_at = now()
        where id = existing.id;
        outcome := 'updated';
      else
        update public.products set synced_at = now() where id = existing.id;
        outcome := 'unchanged';
      end if;
      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('products', ext, err_message, err_constraint);
    end;
  end loop;

  perform public.erp_sync_save(run.id, 'products', counters, errors);
  return counters;
end;
$$;

/* ---------- Outbox ---------- */

create table public.erp_outbox_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  event_type text not null check (event_type in ('dispatch_confirmed')),
  -- Entidad que originó el evento. Para dispatch_confirmed, dispatch_orders.id.
  aggregate_id uuid not null,
  -- La misma en cada reintento. Única: el ERP registra una sola salida por clave.
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 300),
  -- DispatchReport completo (src/lib/erp/types.ts), armado al confirmar. No cambia nunca.
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- pending: espera su primer envío o un reintento (next_attempt_at)
  -- processing: un procesador lo tomó hasta locked_until
  -- sent: el ERP lo aceptó (o ya lo tenía: duplicado)
  -- failed: error permanente o reintentos agotados; requiere atención de logística
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_attempt_at timestamptz,
  -- Código ErpErrorCode y mensaje ya sanitizado (sin credenciales, headers ni trazas del ERP).
  last_error_code text check (last_error_code is null or length(last_error_code) <= 40),
  last_error text check (last_error is null or length(last_error) <= 500),
  erp_reference text check (erp_reference is null or length(erp_reference) <= 300),
  erp_duplicate boolean,
  sent_at timestamptz,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_outbox_events_idempotency_key_key unique (idempotency_key),
  constraint erp_outbox_events_aggregate_key unique (event_type, aggregate_id),
  constraint erp_outbox_events_sent_check check ((status = 'sent') = (sent_at is not null)),
  constraint erp_outbox_events_lock_check check ((status = 'processing') = (locked_until is not null))
);

create index idx_erp_outbox_due on public.erp_outbox_events(next_attempt_at)
  where status in ('pending', 'processing');
create index idx_erp_outbox_company_created on public.erp_outbox_events(company_id, created_at desc);

create trigger trg_erp_outbox_updated_at before update on public.erp_outbox_events
  for each row execute function public.set_updated_at();

-- El evento es inmutable: ni las RPC pueden cambiar a qué se refiere ni qué se manda. Los reintentos
-- reenvían exactamente el mismo payload con la misma clave.
create function public.guard_erp_outbox_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los eventos del outbox ERP no se borran.' using errcode = '42501';
  end if;
  if (new.company_id, new.event_type, new.aggregate_id, new.idempotency_key, new.payload, new.created_by, new.created_at)
     is distinct from (old.company_id, old.event_type, old.aggregate_id, old.idempotency_key, old.payload, old.created_by, old.created_at) then
    raise exception 'El payload y la clave de idempotencia de un evento del outbox ERP no se modifican.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_erp_outbox_event() from public, anon, authenticated;
create trigger trg_erp_outbox_guard before update or delete on public.erp_outbox_events
  for each row execute function public.guard_erp_outbox_event();

-- RLS: logística y depósito ven los reportes de su empresa. Nadie escribe directo: solo las RPC.
alter table public.erp_outbox_events enable row level security;
revoke all on public.erp_outbox_events from anon, authenticated, service_role;
grant select on public.erp_outbox_events to authenticated, service_role;
create policy erp_outbox_events_select on public.erp_outbox_events for select to authenticated
  using (
    company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
  );

/* ---------- Helpers internos (sin EXECUTE para la API) ---------- */

-- Reintentos automáticos: 30 s, 1, 2, 4, 8, 16, 32 min y después cada 1 h, hasta 10 intentos.
create function public.erp_outbox_max_attempts()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

create function public.erp_outbox_backoff(p_attempts integer)
returns interval language sql immutable set search_path = '' as $$
  select least(interval '30 seconds' * power(2, least(greatest(p_attempts, 1) - 1, 10)), interval '1 hour');
$$;

-- Cuánto tiene un procesador para terminar un envío antes de que otro pueda retomarlo. Es bastante más
-- que ERP_TIMEOUT_MS (10 s por defecto) y que el timeout propio del procesador (ver processor.ts).
create function public.erp_outbox_lease()
returns interval language sql immutable set search_path = '' as $$ select interval '2 minutes' $$;

-- Productos sincronizados antes de que existiera external_uom: se usa el nombre más común en el ERP
-- hasta la próxima sincronización.
create function public.erp_outbox_default_uom(p_unit text)
returns text language sql immutable set search_path = '' as $$
  select case p_unit when 'cajas' then 'Caja' when 'kilogramos' then 'Kg' when 'unidades' then 'Unidad' end;
$$;

-- DispatchReport (contrato v1, docs/erp-contract.md §5) de una orden: una línea por pallet esperado.
-- Si un pallet no tiene lote o producto del ERP, la línea sale con ese id en null y el procesador la
-- rechaza como error de validación (requiere atención) sin llamar al ERP.
create function public.erp_outbox_dispatch_payload(p_order_id uuid, p_operator_id uuid, p_dispatched_at timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contractVersion', 1,
    'idempotencyKey', 'dispatch:' || btrim(orders.external_id),
    'orderExternalId', btrim(orders.external_id),
    'dispatchedAt', to_char(p_dispatched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operator', jsonb_build_object('id', operator.id, 'name', operator.name),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'orderLineExternalId', null,
          'palletCode', pallet.qr_code,
          'productExternalId', product.external_id,
          'lotExternalId', batch.external_id,
          'quantity', pallet.quantity,
          'uom', coalesce(product.external_uom, public.erp_outbox_default_uom(product.unit_of_measure))
        ) order by pallet.qr_code)
      from public.order_pallets relation
      join public.pallets pallet on pallet.id = relation.pallet_id
      join public.batches batch on batch.id = pallet.batch_id
      join public.products product on product.id = batch.product_id
      where relation.order_id = orders.id and relation.expected = true
    ), '[]'::jsonb))
  from public.dispatch_orders orders
  join public.users operator on operator.id = p_operator_id
  where orders.id = p_order_id;
$$;

-- Quién procesa: el servidor con service_role (cron, todas las empresas) o un usuario de logística o
-- depósito, solo para su empresa. Devuelve la empresa a la que queda limitado (null = todas).
create function public.erp_outbox_actor_company()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then
    return null;
  end if;
  if auth.uid() is null
     or public.auth_role() is null
     or public.auth_role() not in ('logistics_manager', 'warehouse_operator') then
    raise exception 'No tenés permisos para procesar reportes al ERP.' using errcode = '42501';
  end if;
  return public.auth_company_id();
end;
$$;

revoke all on function public.erp_outbox_max_attempts() from public, anon, authenticated;
revoke all on function public.erp_outbox_backoff(integer) from public, anon, authenticated;
revoke all on function public.erp_outbox_lease() from public, anon, authenticated;
revoke all on function public.erp_outbox_default_uom(text) from public, anon, authenticated;
revoke all on function public.erp_outbox_dispatch_payload(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.erp_outbox_actor_company() from public, anon, authenticated, service_role;

/* ---------- RPC del procesador ---------- */

-- Toma hasta p_limit eventos vencidos (pendientes cuyo next_attempt_at llegó, o en proceso con el lease
-- vencido porque el procesador anterior se cortó) y los marca processing. Suma el intento antes de
-- enviar: un envío interrumpido también cuenta. `skip locked` permite procesadores concurrentes sin que
-- dos tomen el mismo evento. Esta función termina (y libera los locks) antes de llamar al ERP.
create function public.erp_outbox_claim(p_limit integer default 10, p_aggregate_id uuid default null)
returns table (id uuid, idempotency_key text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.erp_outbox_actor_company();
begin
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
    order by event.next_attempt_at, event.created_at
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
  returning event.id, event.idempotency_key, event.payload, event.attempts;
end;
$$;

-- Cierra un envío exitoso. p_attempt es el intento que devolvió erp_outbox_claim: si el evento ya lo
-- retomó otro procesador (lease vencido), este resultado viejo se descarta y devuelve false.
create function public.erp_outbox_mark_sent(p_event_id uuid, p_attempt integer, p_erp_reference text, p_duplicate boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.erp_outbox_actor_company();
begin
  update public.erp_outbox_events event
  set status = 'sent', sent_at = now(), locked_until = null,
      erp_reference = left(nullif(btrim(p_erp_reference), ''), 300),
      erp_duplicate = coalesce(p_duplicate, false),
      last_error_code = null, last_error = null
  where event.id = p_event_id and event.status = 'processing' and event.attempts = p_attempt
    and (v_company is null or event.company_id = v_company);
  return found;
end;
$$;

-- Cierra un envío fallido. Reintentable y con intentos disponibles → vuelve a pending con backoff.
-- Permanente (validación, credenciales, conflicto...) o sin intentos → failed. Devuelve el estado nuevo,
-- o null si el resultado quedó viejo (ver erp_outbox_mark_sent).
create function public.erp_outbox_mark_failed(
  p_event_id uuid,
  p_attempt integer,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.erp_outbox_actor_company();
  v_status text;
begin
  update public.erp_outbox_events event
  set status = case
        when p_retryable and event.attempts < public.erp_outbox_max_attempts() then 'pending'
        else 'failed'
      end,
      next_attempt_at = case
        when p_retryable and event.attempts < public.erp_outbox_max_attempts()
          then now() + public.erp_outbox_backoff(event.attempts)
        else event.next_attempt_at
      end,
      locked_until = null,
      last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'unknown'), 40),
      last_error = left(coalesce(nullif(btrim(p_error_message), ''), 'Error desconocido al reportar al ERP.'), 500)
  where event.id = p_event_id and event.status = 'processing' and event.attempts = p_attempt
    and (v_company is null or event.company_id = v_company)
  returning event.status into v_status;
  return v_status;
end;
$$;

-- Logística puede pedir un reintento inmediato: un evento failed (después de corregir la causa en el
-- ERP) o uno pending que espera su backoff. Mismo payload y misma clave; suma un intento más.
create function public.erp_outbox_requeue(p_event_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede reintentar reportes al ERP.' using errcode = '42501';
  end if;
  update public.erp_outbox_events event
  set status = 'pending', next_attempt_at = now()
  where event.id = p_event_id and event.company_id = public.auth_company_id()
    and event.status in ('pending', 'failed');
  return found;
end;
$$;

revoke all on function public.erp_outbox_claim(integer, uuid) from public, anon;
revoke all on function public.erp_outbox_mark_sent(uuid, integer, text, boolean) from public, anon;
revoke all on function public.erp_outbox_mark_failed(uuid, integer, text, text, boolean) from public, anon;
revoke all on function public.erp_outbox_requeue(uuid) from public, anon, service_role;
grant execute on function public.erp_outbox_claim(integer, uuid) to authenticated, service_role;
grant execute on function public.erp_outbox_mark_sent(uuid, integer, text, boolean) to authenticated, service_role;
grant execute on function public.erp_outbox_mark_failed(uuid, integer, text, text, boolean) to authenticated, service_role;
grant execute on function public.erp_outbox_requeue(uuid) to authenticated;

/* ---------- confirm_dispatch_order + outbox ---------- */

-- Igual que en 20260919180000_add_order_notifications.sql, más el alta del evento del outbox para las
-- órdenes del ERP. Todo en la misma transacción: si el outbox no se puede escribir, la confirmación se
-- revierte entera; si se confirma, el reporte queda garantizado. La llamada al ERP no ocurre acá.
-- Confirmar dos veces no duplica el reporte: el `for update` sobre la orden serializa y la segunda
-- confirmación devuelve invalid_status; además los índices únicos del outbox lo impiden.
create or replace function confirm_dispatch_order(
  p_order_id uuid
)
returns table (
  outcome text,
  order_id uuid,
  status text,
  confirmed_at timestamptz,
  pallet_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order dispatch_orders%rowtype;
  v_total integer;
  v_missing integer;
  v_missing_ids uuid[];
  v_last_missing_ids uuid[];
  v_confirmed_at timestamptz := now();
begin
  if auth.uid() is null or auth_role() is distinct from 'warehouse_operator' then
    return query select 'forbidden', null::uuid, null::text,
      null::timestamptz, null::integer;
    return;
  end if;

  select orders.*
    into v_order
  from dispatch_orders orders
  where orders.id = p_order_id
    and orders.company_id = auth_company_id()
  for update;

  if not found then
    return query select 'order_not_found', null::uuid, null::text,
      null::timestamptz, null::integer;
    return;
  end if;

  if v_order.status <> 'draft' then
    return query select 'invalid_status', v_order.id, v_order.status::text,
      v_order.confirmed_at, null::integer;
    return;
  end if;

  select count(*)
    into v_total
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.expected = true;

  if v_total = 0 then
    return query select 'no_pallets', v_order.id, v_order.status::text,
      null::timestamptz, null::integer;
    return;
  end if;

  select array_agg(relation.pallet_id order by relation.pallet_id)
    into v_missing_ids
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.expected = true
    and relation.validated_at is null;

  v_missing := coalesce(array_length(v_missing_ids, 1), 0);

  if v_missing > 0 then
    select notification.missing_pallet_ids
      into v_last_missing_ids
    from order_notifications notification
    where notification.order_id = p_order_id
      and notification.event_type = 'dispatch_missing_pallets'
    order by notification.seq desc
    limit 1;

    if v_last_missing_ids is null or v_last_missing_ids <> v_missing_ids then
      insert into order_notifications (
        company_id,
        order_id,
        missing_pallet_ids,
        event_type,
        description,
        created_by
      ) values (
        auth_company_id(),
        p_order_id,
        v_missing_ids,
        'dispatch_missing_pallets',
        format('Quedan %s pallet(s) esperados sin validar; no se pudo confirmar el despacho.', v_missing),
        auth.uid()
      );
    end if;

    return query select 'missing_pallets', v_order.id, v_order.status::text,
      null::timestamptz, v_missing;
    return;
  end if;

  update dispatch_orders
  set status = 'confirmed',
      confirmed_at = v_confirmed_at
  where id = p_order_id;

  update pallets
  set status = 'in_transit',
      current_location = 'En tránsito'
  where id in (
    select relation.pallet_id
    from order_pallets relation
    where relation.order_id = p_order_id
      and relation.expected = true
  );

  insert into traceability_events (
    company_id,
    order_id,
    event_type,
    user_id,
    details,
    created_at
  ) values (
    auth_company_id(),
    p_order_id,
    'dispatch_confirmed',
    auth.uid(),
    jsonb_build_object('pallet_count', v_total),
    v_confirmed_at
  );

  -- US-ERP-04: las órdenes que vinieron del ERP se le informan. Las cargadas a mano no tienen a quién.
  if v_order.external_id is not null then
    insert into erp_outbox_events (
      company_id,
      event_type,
      aggregate_id,
      idempotency_key,
      payload,
      created_by
    ) values (
      v_order.company_id,
      'dispatch_confirmed',
      p_order_id,
      'dispatch:' || btrim(v_order.external_id),
      erp_outbox_dispatch_payload(p_order_id, auth.uid(), v_confirmed_at),
      auth.uid()
    )
    on conflict do nothing;
  end if;

  return query select 'confirmed', v_order.id, 'confirmed'::text,
    v_confirmed_at, v_total;
end;
$$;

revoke all on function confirm_dispatch_order(uuid) from public;
grant execute on function confirm_dispatch_order(uuid) to authenticated;
