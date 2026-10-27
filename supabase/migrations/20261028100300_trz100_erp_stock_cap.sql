-- TRZ-100 (4/4): tope de pallets por saldo del ERP, vista "Stock según ERP" y estado del remito en el panel.
--
-- Regla (docs/erp-sync.md, "Tope por saldo"): por (empresa, lote, warehouse_code), la suma de los pallets que
-- cuentan no puede superar el saldo del ERP. El saldo es la suma de los erp_stock_balances de ese lote cuyos
-- depósitos del ERP están vinculados a ese warehouse_code. Solo aplica a lotes del ERP
-- (batches.source_system = 'erp'): los lotes manuales no tienen tope.
--
-- Qué pallets cuentan (columna `phase` de erp_pallet_stock_usage):
--
--   phase                     estado del pallet / despacho                                      ¿cuenta?
--   in_warehouse              in_warehouse o assigned (en depósito o en una orden sin confirmar)    sí
--   report_pending            despachado; el reporte al ERP no se envió (pending/processing/failed) sí
--   document_pending          reporte enviado; remito sin consultar o en borrador                  sí
--   confirmed_unsynced        remito confirmado, pero el saldo no se sincronizó después de verlo   sí
--   released                  remito confirmado y saldo sincronizado después de verlo              no
--   document_problem          remito anulado o no encontrado en el ERP                              sí (+ aviso)
--   not_tracked               evento anterior a TRZ-100 (marcado not_tracked)                       no
--   manual_order              despachado en una orden sin external_id (sin reporte al ERP)          no
--   untracked_dispatch        orden del ERP despachada sin evento en el outbox (anterior a US-ERP-04) no
--   departed_without_dispatch salió del depósito sin un despacho confirmado (no debería pasar)      sí
--
-- "Despachado" = el pallet ya no está in_warehouse/assigned. Todos los estados de salida (in_transit,
-- received, discrepancy, delivered, delivery_discrepancy) se alcanzan solo después de confirm_dispatch_order,
-- que los deja in_transit; el despacho que cuenta es la orden confirmada (confirmed_at no nulo) donde el pallet
-- estaba con expected = true. La desasociación de TRZ-99 solo devuelve a in_warehouse pallets assigned de
-- órdenes en borrador, así que un pallet desasociado vuelve a la primera fila.
--
-- "Saldo sincronizado después de ver la confirmación" = el synced_at más viejo entre los saldos de ese lote en
-- ese warehouse_code es posterior a erp_document_confirmed_seen_at del evento (20261028100100).

/* ---------- Clasificación de pallets ---------- */

-- Pallets de lotes del ERP de una empresa (opcionalmente de un lote y un depósito) con su fase y si cuentan
-- contra el saldo. Uso interno: el trigger del tope y erp_stock_overview.
create function public.erp_pallet_stock_usage(p_company_id uuid, p_batch_id uuid default null, p_warehouse_code text default null)
returns table (
  pallet_id uuid,
  batch_id uuid,
  warehouse_code text,
  quantity numeric,
  phase text,
  counts boolean,
  event_id uuid,
  erp_reference text
)
language sql stable security definer set search_path = '' as $$
  with classified as (
    select
      pallet.id,
      pallet.batch_id,
      pallet.warehouse_code,
      coalesce(pallet.quantity, 0) as quantity,
      event.id as event_id,
      event.erp_reference,
      case
        when pallet.status in ('in_warehouse', 'assigned') then 'in_warehouse'
        when dispatch.order_id is null then 'departed_without_dispatch'
        when dispatch.external_id is null then 'manual_order'
        when event.id is null then 'untracked_dispatch'
        when event.status <> 'sent' then 'report_pending'
        when event.erp_document_status = 'not_tracked' then 'not_tracked'
        when event.erp_document_status is null or event.erp_document_status = 'draft' then 'document_pending'
        when event.erp_document_status in ('cancelled', 'not_found') then 'document_problem'
        when balance.oldest_synced_at > event.erp_document_confirmed_seen_at then 'released'
        else 'confirmed_unsynced'
      end as phase
    from public.pallets pallet
    join public.batches batch on batch.id = pallet.batch_id and batch.source_system = 'erp'
    left join lateral (
      select orders.id as order_id, orders.external_id
      from public.order_pallets relation
      join public.dispatch_orders orders on orders.id = relation.order_id
      where relation.pallet_id = pallet.id and relation.expected = true and orders.confirmed_at is not null
      order by orders.confirmed_at desc
      limit 1
    ) dispatch on pallet.status not in ('in_warehouse', 'assigned')
    left join public.erp_outbox_events event
      on event.event_type = 'dispatch_confirmed' and event.aggregate_id = dispatch.order_id
      and event.company_id = pallet.company_id
    left join lateral (
      select min(stock.synced_at) as oldest_synced_at
      from public.erp_stock_balances stock
      join public.erp_warehouse_mappings mapping
        on mapping.company_id = stock.company_id and mapping.external_warehouse_id = stock.external_warehouse_id
        and mapping.warehouse_code = stock.warehouse_code
      where stock.company_id = pallet.company_id and stock.batch_id = pallet.batch_id
        and stock.warehouse_code = pallet.warehouse_code
    ) balance on event.erp_document_status = 'confirmed'
    where pallet.company_id = p_company_id
      and (p_batch_id is null or pallet.batch_id = p_batch_id)
      and (p_warehouse_code is null or pallet.warehouse_code = p_warehouse_code)
  )
  select id, batch_id, warehouse_code, quantity, phase,
         phase in ('in_warehouse', 'report_pending', 'document_pending', 'confirmed_unsynced',
                   'document_problem', 'departed_without_dispatch'),
         event_id, erp_reference
  from classified;
$$;
revoke all on function public.erp_pallet_stock_usage(uuid, uuid, text) from public, anon, authenticated, service_role;

/* ---------- Tope (trigger) ---------- */

-- Se valida en la base y no solo en la app: logística puede insertar pallets directo por la API de Supabase
-- (policy pallets_insert_manager). Errores propios:
--   TF100 supera el saldo (DETAIL: {"available": n, "unit": "...", "lot": "...", "warehouseCode": "..."})
--   TF101 el lote no tiene saldo en el ERP para ese depósito
--   TF102 lote o producto inactivo en el ERP
--
-- Concurrencia: dos altas simultáneas del mismo lote y depósito se serializan en el `for update` sobre sus
-- filas de erp_stock_balances. En read committed, cada sentencia de esta función toma una foto nueva de la
-- base, así que la suma que corre después de obtener el lock ya ve el pallet que confirmó la primera
-- transacción. La sincronización también bloquea esas filas al actualizar el saldo.
--
-- Lo que la base no puede impedir: que el saldo baje en una sincronización o que un remito se anule y sus
-- pallets vuelvan a contar. La suma puede quedar por encima del saldo; no se rompe nada y la vista muestra el
-- disponible negativo con un aviso. Por eso una edición que baja la cantidad (o no la sube) no se valida.
create function public.enforce_erp_stock_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.batches;
  v_product public.products;
  v_balance numeric;
  v_rows integer;
  v_used numeric;
  v_available numeric;
begin
  if tg_op = 'UPDATE'
     and new.batch_id = old.batch_id
     and new.warehouse_code = old.warehouse_code
     and coalesce(new.quantity, 0) <= coalesce(old.quantity, 0) then
    return new;
  end if;

  select * into v_lot from public.batches where id = new.batch_id;
  if not found or v_lot.source_system <> 'erp' then
    return new;
  end if;
  select * into v_product from public.products where id = v_lot.product_id;
  if v_lot.external_active is false or v_product.external_active is false then
    raise exception 'El lote % o su producto está inactivo en el ERP: no se pueden armar pallets.', v_lot.batch_number
      using errcode = 'TF102';
  end if;

  select coalesce(sum(locked.quantity), 0), count(*) into v_balance, v_rows
  from (
    select stock.quantity
    from public.erp_stock_balances stock
    join public.erp_warehouse_mappings mapping
      on mapping.company_id = stock.company_id and mapping.external_warehouse_id = stock.external_warehouse_id
      and mapping.warehouse_code = stock.warehouse_code
    where stock.company_id = new.company_id and stock.batch_id = new.batch_id
      and stock.warehouse_code = new.warehouse_code
    order by stock.external_warehouse_id
    for update of stock
  ) locked;
  if v_rows = 0 then
    raise exception 'Ese lote no tiene saldo en el ERP para este depósito.' using errcode = 'TF101';
  end if;

  select coalesce(sum(usage.quantity), 0) into v_used
  from public.erp_pallet_stock_usage(new.company_id, new.batch_id, new.warehouse_code) usage
  where usage.counts and usage.pallet_id <> new.id;

  v_available := v_balance - v_used;
  if coalesce(new.quantity, 0) > v_available then
    raise exception 'La cantidad supera el saldo del ERP: disponible % % del lote % en %.',
        greatest(v_available, 0), v_product.unit_of_measure, v_lot.batch_number, new.warehouse_code
      using errcode = 'TF100',
            detail = jsonb_build_object(
              'available', v_available,
              'unit', v_product.unit_of_measure,
              'lot', v_lot.batch_number,
              'warehouseCode', new.warehouse_code)::text;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_erp_stock_cap() from public, anon, authenticated, service_role;

create trigger trg_pallets_erp_stock_cap
  before insert or update of quantity, batch_id, warehouse_code on public.pallets
  for each row execute function public.enforce_erp_stock_cap();

/* ---------- Vista "Stock según ERP" ---------- */

-- Una fila por lote × depósito de TrazFlow con saldo en el ERP (los depósitos del ERP vinculados al mismo
-- warehouse_code se suman). Logística y depósito de la empresa.
--   built                 pallets que todavía no salieron (en depósito o asignados)
--   dispatched_pending    despachados que siguen contando (el ERP todavía no los descontó)
--   available             saldo - todo lo que cuenta (puede ser negativo, ver el trigger)
--   oldest_synced_at      sincronización más vieja entre los saldos sumados
--   document_label        awaiting_document | confirmed_unsynced | document_problem | null (al día)
--   awaiting_quantity     cantidad despachada con el remito sin confirmar (reporte pendiente, sin consultar o
--                         en borrador), para el aviso del formulario de alta
--   awaiting_references   remitos en borrador o sin consultar (p. ej. MAT-DN-2026-00001)
create function public.erp_stock_overview()
returns table (
  batch_id uuid,
  batch_number text,
  expiration_date date,
  lot_active boolean,
  product_id uuid,
  product_name text,
  product_sku text,
  unit_of_measure text,
  product_active boolean,
  warehouse_code text,
  erp_quantity numeric,
  built numeric,
  dispatched_pending numeric,
  available numeric,
  oldest_synced_at timestamptz,
  document_label text,
  awaiting_quantity numeric,
  awaiting_references text[]
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
begin
  if auth.uid() is null or v_company is null
     or public.auth_role() is null
     or public.auth_role() not in ('logistics_manager', 'warehouse_operator') then
    raise exception 'Solo logística y depósito pueden consultar el stock del ERP.' using errcode = '42501';
  end if;

  return query
  with balances as (
    select stock.batch_id, stock.warehouse_code, sum(stock.quantity) as quantity, min(stock.synced_at) as oldest_synced_at
    from public.erp_stock_balances stock
    join public.erp_warehouse_mappings mapping
      on mapping.company_id = stock.company_id and mapping.external_warehouse_id = stock.external_warehouse_id
      and mapping.warehouse_code = stock.warehouse_code
    where stock.company_id = v_company
    group by stock.batch_id, stock.warehouse_code
  ),
  pallet_usage as (
    select
      u.batch_id, u.warehouse_code,
      coalesce(sum(u.quantity) filter (where u.phase = 'in_warehouse'), 0) as built,
      coalesce(sum(u.quantity) filter (where u.counts and u.phase <> 'in_warehouse'), 0) as dispatched_pending,
      coalesce(sum(u.quantity) filter (where u.counts), 0) as used,
      coalesce(sum(u.quantity) filter (where u.phase in ('report_pending', 'document_pending')), 0) as awaiting_quantity,
      bool_or(u.phase = 'document_problem') as has_problem,
      bool_or(u.phase in ('report_pending', 'document_pending')) as has_awaiting,
      bool_or(u.phase = 'confirmed_unsynced') as has_unsynced,
      array_remove(array_agg(distinct u.erp_reference) filter (where u.phase = 'document_pending'), null) as refs
    from public.erp_pallet_stock_usage(v_company, null, null) u
    group by u.batch_id, u.warehouse_code
  )
  select
    batch.id, batch.batch_number, batch.expiration_date, coalesce(batch.external_active, true),
    product.id, product.name, product.sku, product.unit_of_measure, coalesce(product.external_active, true),
    balances.warehouse_code, balances.quantity,
    coalesce(pallet_usage.built, 0), coalesce(pallet_usage.dispatched_pending, 0),
    balances.quantity - coalesce(pallet_usage.used, 0),
    balances.oldest_synced_at,
    case
      when pallet_usage.has_problem then 'document_problem'
      when pallet_usage.has_awaiting then 'awaiting_document'
      when pallet_usage.has_unsynced then 'confirmed_unsynced'
    end,
    coalesce(pallet_usage.awaiting_quantity, 0),
    coalesce(pallet_usage.refs, '{}')
  from balances
  join public.batches batch on batch.id = balances.batch_id
  join public.products product on product.id = batch.product_id
  left join pallet_usage on pallet_usage.batch_id = balances.batch_id and pallet_usage.warehouse_code = balances.warehouse_code
  order by product.name, batch.expiration_date nulls last, batch.batch_number, balances.warehouse_code;
end;
$$;
revoke all on function public.erp_stock_overview() from public, anon, service_role;
grant execute on function public.erp_stock_overview() to authenticated;

/* ---------- Panel de integración: estado del remito ---------- */

-- Igual que en 20261019150000_erp_integration_panel.sql, más erp_document_status (null en las
-- sincronizaciones). Cambia el tipo de retorno, por eso se recrea.
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
      null::text as erp_reference, run.provider, null::text as erp_document_status
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
      event.erp_reference, null::text, event.erp_document_status
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
    a.provider, a.erp_document_status, count(*) over ()
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

-- Igual que en 20261019150000_erp_integration_panel.sql, más el estado del remito y la línea de la orden de
-- cada pallet del reporte.
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
