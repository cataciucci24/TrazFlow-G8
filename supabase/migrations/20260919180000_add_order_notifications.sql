-- ============================================================================
-- US18 (TRZ-20): log de notificaciones de inconsistencias en el despacho
-- ============================================================================
-- Hoy las inconsistencias detectadas en el flujo de despacho quedan solo en
-- `traceability_events` (auditoría interna, sin distinción de rol) y son
-- visibles nada más para warehouse_operator vía
-- getOrderDispatchDiscrepancies. Esta tabla es el log de notificaciones
-- visible por rol que pide la historia: logistics_manager y
-- warehouse_operator ven las mismas inconsistencias dentro de la orden.
--
-- Alcance de esta historia (confirmado con el usuario): se loguean acá dos
-- tipos de inconsistencia, ambas ya detectadas hoy en el flujo de
-- confirmación de despacho:
--   - dispatch_wrong_pallet: un pallet escaneado en US3/US4 que no pertenece
--     a la orden (hoy ya dispara un evento 'dispatch_discrepancy' en
--     traceability_events). Una fila por pallet incorrecto detectado.
--   - dispatch_missing_pallets: un intento de confirmar (US5) bloqueado
--     porque quedan pallets esperados sin validar.
--
--     Un mismo order_id SÍ puede volver a generar este tipo de notificación
--     más de una vez: `associatePallets` (src/lib/orders/actions.ts) permite
--     a logistics_manager asociar pallets nuevos a una orden mientras siga
--     en 'draft', sin exigir que ya haya un confirm exitoso ni que no haya
--     habido un bloqueo previo. Es decir, un bloqueo por faltantes puede
--     quedar "viejo" (otro conjunto de pallets) y luego repetirse con un
--     conjunto distinto tras agregar más pallets a la orden.
--
--     Por eso el dedup NO es "una fila por orden para siempre": se guarda
--     `missing_pallet_ids` (el conjunto de pallets pendientes en ese
--     intento, siempre insertado ya ordenado) y solo se inserta una fila
--     nueva si ese conjunto difiere del de la última notificación
--     dispatch_missing_pallets registrada para la orden. La comparación es
--     por conjunto, no posicional: al guardar siempre ordenado, dos
--     conjuntos iguales en cualquier orden de detección quedan
--     representados por el mismo array y comparan iguales con `=`.
--
-- Fuera de alcance (Sprint 2 / "Gestionar diferencias detectadas en
-- recepción"): cualquier acción correctiva sobre la mercadería, y las
-- discrepancias detectadas en la recepción del distribuidor.

create table order_notifications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  order_id      uuid not null references dispatch_orders(id) on delete cascade,
  pallet_id     uuid references pallets(id) on delete set null,
  -- Solo poblado para dispatch_missing_pallets: el conjunto de pallets
  -- pendientes de validar en ese intento, siempre guardado ordenado por id
  -- para que la comparación de "mismo conjunto" con `=` sea por contenido y
  -- no dependa del orden de detección (ver nota arriba).
  missing_pallet_ids uuid[],
  event_type    text not null,
  description   text not null,
  -- Roles que pueden ver esta fila. Default fijo para todo lo que inserta
  -- esta historia (ambas roles ven todo); queda como columna por fila y no
  -- como policy fija para no tener que migrar RLS si a futuro un tipo de
  -- evento necesita otra combinación de roles.
  visible_roles user_role[] not null
    default array['logistics_manager', 'warehouse_operator']::user_role[],
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

create index idx_order_notifications_order on order_notifications(order_id, created_at desc);
create index idx_order_notifications_company on order_notifications(company_id);

alter table order_notifications enable row level security;

create policy order_notifications_select on order_notifications
  for select using (
    company_id = auth_company_id()
    and auth_role() = any(visible_roles)
  );

-- Los inserts salen únicamente de los RPCs de despacho (validate_order_pallet,
-- confirm_dispatch_order), que corren security invoker como warehouse_operator
-- (mismo patrón que ya usan para traceability_events).
create policy order_notifications_insert on order_notifications
  for insert with check (
    company_id = auth_company_id()
    and auth_role() = 'warehouse_operator'
  );

-- ----------------------------------------------------------------------------
-- validate_order_pallet: además del traceability_event 'dispatch_discrepancy'
-- ya existente, registra la notificación visible por rol para el pallet
-- incorrecto.
-- ----------------------------------------------------------------------------
create or replace function validate_order_pallet(
  p_order_id uuid,
  p_qr_code text
)
returns table (
  outcome text,
  pallet_id uuid,
  qr_code text,
  product_name text,
  product_sku text,
  batch_number text,
  validated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pallet pallets%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_product_name text;
  v_product_sku text;
  v_batch_number text;
  v_validated_at timestamptz := now();
begin
  if auth.uid() is null or auth_role() is distinct from 'warehouse_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
    from dispatch_orders orders
    where orders.id = p_order_id
      and orders.company_id = auth_company_id()
  ) then
    return query select 'order_not_found', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.*
    into v_pallet
  from pallets pallet
  where pallet.qr_code = btrim(p_qr_code)
    and pallet.company_id = auth_company_id();

  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select relation.*
    into v_order_pallet
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.pallet_id = v_pallet.id
  for update;

  if not found then
    insert into traceability_events (
      company_id,
      pallet_id,
      order_id,
      event_type,
      user_id,
      details,
      created_at
    ) values (
      auth_company_id(),
      v_pallet.id,
      p_order_id,
      'dispatch_discrepancy',
      auth.uid(),
      jsonb_build_object(
        'type', 'wrong_order',
        'qr_code', v_pallet.qr_code
      ),
      v_validated_at
    );

    insert into order_notifications (
      company_id,
      order_id,
      pallet_id,
      event_type,
      description,
      created_by,
      created_at
    ) values (
      auth_company_id(),
      p_order_id,
      v_pallet.id,
      'dispatch_wrong_pallet',
      format('Se escaneó el pallet %s, que no pertenece a esta orden de despacho.', v_pallet.qr_code),
      auth.uid(),
      v_validated_at
    );

    return query select 'wrong_order', v_pallet.id, v_pallet.qr_code,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select product.name, product.sku, batch.batch_number
    into v_product_name, v_product_sku, v_batch_number
  from batches batch
  join products product on product.id = batch.product_id
  where batch.id = v_pallet.batch_id;

  if v_order_pallet.validated_at is not null then
    return query select 'already_validated', v_pallet.id, v_pallet.qr_code,
      v_product_name, v_product_sku, v_batch_number,
      v_order_pallet.validated_at;
    return;
  end if;

  update order_pallets relation
  set detected_at_dispatch = true,
      validated_at = v_validated_at,
      validated_by = auth.uid()
  where relation.order_id = p_order_id
    and relation.pallet_id = v_pallet.id;

  insert into traceability_events (
    company_id,
    pallet_id,
    order_id,
    event_type,
    user_id,
    details,
    created_at
  ) values (
    auth_company_id(),
    v_pallet.id,
    p_order_id,
    'qr_scan',
    auth.uid(),
    jsonb_build_object('qr_code', v_pallet.qr_code),
    v_validated_at
  );

  return query select 'validated', v_pallet.id, v_pallet.qr_code,
    v_product_name, v_product_sku, v_batch_number, v_validated_at;
end;
$$;

revoke all on function validate_order_pallet(uuid, text) from public;
grant execute on function validate_order_pallet(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- confirm_dispatch_order: registra dispatch_missing_pallets cuando bloquea la
-- confirmación por pallets esperados sin validar, pero solo si el conjunto
-- de pallets pendientes cambió respecto a la última notificación de este
-- tipo para la orden (ver nota de dedup arriba). El `for update` sobre
-- dispatch_orders al principio de la función ya serializa confirmaciones
-- concurrentes de la misma orden, así que este check-then-insert no
-- necesita una constraint unique aparte para ser race-safe.
-- ----------------------------------------------------------------------------
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
security invoker
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
    order by notification.created_at desc
    limit 1;

    -- v_missing_ids ya viene ordenado por pallet_id (mismo criterio con el
    -- que se guarda missing_pallet_ids), así que comparar con `=` es una
    -- comparación por conjunto, no posicional.
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

  return query select 'confirmed', v_order.id, 'confirmed'::text,
    v_confirmed_at, v_total;
end;
$$;

revoke all on function confirm_dispatch_order(uuid) from public;
grant execute on function confirm_dispatch_order(uuid) to authenticated;
