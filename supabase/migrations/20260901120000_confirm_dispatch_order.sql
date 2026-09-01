-- ============================================================================
-- US5: confirmar despacho
-- ============================================================================
-- El operador de depósito (mismo rol que valida QR en US3/US4) confirma el
-- despacho una vez que la carga quedó completamente validada. Hoy
-- `dispatch_orders.status` nunca sale de 'draft' (ningún código lo mueve a
-- 'validating' ni 'has_discrepancy'), así que la única transición de origen
-- válida en este sprint es 'draft' -> 'confirmed'.
--
-- Regla de negocio: no se puede confirmar mientras haya pallets esperados
-- (order_pallets.expected = true) sin validar (validated_at is null). Los
-- pallets "incorrectos" de US4 (wrong_order) nunca se insertan en
-- order_pallets, así que no bloquean la confirmación: son solo informativos
-- vía traceability_events.

-- Evita que dos confirmaciones concurrentes (o un reintento tras un error de
-- red del cliente) dejen dos eventos 'dispatch_confirmed' para la misma
-- orden. Mismo patrón que idx_events_single_qr_validation (US3).
create unique index idx_events_single_dispatch_confirmation
  on traceability_events(order_id, event_type)
  where event_type = 'dispatch_confirmed';

-- La policy original permitía a cualquier usuario de la empresa (o del
-- distribuidor destinatario) actualizar cualquier campo de la orden, sin
-- restricción de rol. Se acota a la transición que necesita US5, dejando
-- lugar para que US6 agregue su propia policy para distributor_operator sin
-- tener que tocar esta de nuevo (mismo criterio que
-- order_pallets_update_warehouse en US3).
drop policy orders_update on dispatch_orders;

create policy orders_update_warehouse_confirm on dispatch_orders
  for update using (
    auth_role() = 'warehouse_operator'
    and company_id = auth_company_id()
  )
  with check (
    auth_role() = 'warehouse_operator'
    and company_id = auth_company_id()
    and status = 'confirmed'
  );

-- La función corre con los permisos y RLS del usuario que la invoca. El
-- `for update` sobre dispatch_orders serializa confirmaciones concurrentes
-- de la misma orden: la segunda ve el status ya en 'confirmed' y devuelve
-- 'invalid_status' en vez de duplicar el evento o pisar confirmed_at.
create or replace function confirm_dispatch_order(
  p_order_id uuid
)
returns table (
  outcome text,
  order_id uuid,
  status text,
  confirmed_at timestamptz,
  -- Cantidad de pallets confirmados si outcome = 'confirmed', o cantidad de
  -- pallets pendientes de validar si outcome = 'missing_pallets'; null en
  -- cualquier otro outcome.
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

  select count(*)
    into v_missing
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.expected = true
    and relation.validated_at is null;

  if v_missing > 0 then
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
