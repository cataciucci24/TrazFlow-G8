-- ============================================================================
-- TRZ-99: transición inválida de estado al desasociar pallets
-- ============================================================================
-- Tres caminos permitían que un pallet ya despachado o entregado volviera a
-- figurar 'in_warehouse' (disponible para otra orden):
--
-- 1. La policy order_pallets_insert_manager solo validaba rol y empresa: por
--    la API se podía asociar a una orden en borrador un pallet 'delivered',
--    'in_transit', etc., o un pallet que ya estaba en otra orden.
-- 2. dissociate_pallet_from_order pasaba el pallet a 'in_warehouse' sin mirar
--    su estado, y registraba un 'pallet_dissociated' falso.
-- 3. guard_direct_pallet_status (20261016130100_pallet_physical_locations.sql)
--    ya limita la API a in_warehouse <-> assigned, pero dejaba pasar a
--    'in_warehouse' un pallet que sigue dentro de una orden activa, sin
--    desasociarlo: figuraba disponible en depósito estando en una orden.
--
-- La app sigue reservando el pallet ('in_warehouse' -> 'assigned') con un
-- UPDATE y después inserta en order_pallets; eso no cambia. Las transiciones
-- de despacho, recepción y entrega se hacen en funciones SECURITY DEFINER, que
-- el trigger deja pasar.

-- ----------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER para no consultar pallets/dispatch_orders desde
-- las policies de order_pallets: produciría recursión RLS, ver
-- 20260831235900_add_pallet_validation.sql).
-- ----------------------------------------------------------------------------

-- ¿El pallet está en alguna orden que todavía no terminó? Opcionalmente
-- ignora una orden (la que se está armando).
create or replace function public.pallet_in_active_order(
  p_pallet_id uuid,
  p_exclude_order_id uuid default null
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from order_pallets relation
    join dispatch_orders orders on orders.id = relation.order_id
    where relation.pallet_id = p_pallet_id
      and (p_exclude_order_id is null or relation.order_id <> p_exclude_order_id)
      and orders.company_id = auth_company_id()
      and orders.status in ('draft', 'validating', 'has_discrepancy', 'confirmed')
  );
$$;

-- Un pallet se puede sumar a una orden solo si la orden es de la empresa y
-- está en borrador, y el pallet es de la empresa, ya fue reservado
-- ('assigned') y no está en otra orden activa.
create or replace function public.order_pallet_insert_allowed(
  p_order_id uuid,
  p_pallet_id uuid
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
      select 1 from dispatch_orders orders
      where orders.id = p_order_id
        and orders.company_id = auth_company_id()
        and orders.status = 'draft'
    )
    and exists (
      select 1 from pallets pallet
      where pallet.id = p_pallet_id
        and pallet.company_id = auth_company_id()
        and pallet.status = 'assigned'
    )
    and not pallet_in_active_order(p_pallet_id, p_order_id);
$$;

revoke all on function public.pallet_in_active_order(uuid, uuid) from public, anon;
revoke all on function public.order_pallet_insert_allowed(uuid, uuid) from public, anon;
grant execute on function public.pallet_in_active_order(uuid, uuid) to authenticated;
grant execute on function public.order_pallet_insert_allowed(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 1. Alta de asociaciones
-- ----------------------------------------------------------------------------
drop policy if exists order_pallets_insert_manager on public.order_pallets;
create policy order_pallets_insert_manager on public.order_pallets
  for insert to authenticated
  with check (
    auth_role() = 'logistics_manager'
    and order_pallet_insert_allowed(order_id, pallet_id)
  );

-- ----------------------------------------------------------------------------
-- 2. Desasociación: solo un pallet 'assigned' vuelve a 'in_warehouse'.
-- Misma firma y comportamiento que 20261006120000_log_pallet_dissociation.sql,
-- más el bloqueo y la verificación del estado del pallet.
-- ----------------------------------------------------------------------------
create or replace function dissociate_pallet_from_order(
  p_order_id uuid,
  p_pallet_id uuid
)
returns table (
  outcome text,
  order_id uuid,
  pallet_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order dispatch_orders%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_pallet_status pallet_status;
  v_qr_code text;
begin
  if auth.uid() is null or auth_role() is distinct from 'logistics_manager' then
    return query select 'forbidden', null::uuid, null::uuid;
    return;
  end if;

  select orders.*
    into v_order
  from dispatch_orders orders
  where orders.id = p_order_id
    and orders.company_id = auth_company_id()
  for update;

  if not found then
    return query select 'order_not_found', null::uuid, null::uuid;
    return;
  end if;

  if v_order.status <> 'draft' then
    return query select 'not_removable', v_order.id, p_pallet_id;
    return;
  end if;

  select relation.*
    into v_order_pallet
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.pallet_id = p_pallet_id
  for update;

  if not found then
    return query select 'pallet_not_in_order', v_order.id, p_pallet_id;
    return;
  end if;

  if v_order_pallet.validated_at is not null then
    return query select 'not_removable', v_order.id, p_pallet_id;
    return;
  end if;

  select pallet.status, pallet.qr_code
    into v_pallet_status, v_qr_code
  from pallets pallet
  where pallet.id = p_pallet_id
    and pallet.company_id = auth_company_id()
  for update;

  if not found or v_pallet_status <> 'assigned' then
    return query select 'invalid_pallet_state', v_order.id, p_pallet_id;
    return;
  end if;

  delete from order_pallets relation
  where relation.order_id = p_order_id
    and relation.pallet_id = p_pallet_id;

  update pallets
  set status = 'in_warehouse'
  where id = p_pallet_id
    and company_id = auth_company_id();

  insert into traceability_events (
    company_id,
    pallet_id,
    order_id,
    event_type,
    user_id,
    details
  ) values (
    auth_company_id(),
    p_pallet_id,
    p_order_id,
    'pallet_dissociated',
    auth.uid(),
    jsonb_build_object('qr_code', v_qr_code)
  );

  return query select 'dissociated', v_order.id, p_pallet_id;
end;
$$;

revoke all on function dissociate_pallet_from_order(uuid, uuid) from public;
grant execute on function dissociate_pallet_from_order(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Cambios de estado de pallets desde la API
-- ----------------------------------------------------------------------------
-- Misma función que 20261016130100_pallet_physical_locations.sql (sigue
-- SECURITY INVOKER: current_user distingue la API de las RPC SECURITY
-- DEFINER), más una regla: assigned -> in_warehouse solo si el pallet no está
-- en una orden activa (liberar una reserva que no llegó a asociarse, como el
-- rollback de createDispatchOrder). Para sacarlo de una orden está
-- dissociate_pallet_from_order.
create or replace function public.guard_direct_pallet_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.status is distinct from old.status then
    if old.status not in ('in_warehouse', 'assigned')
      or new.status not in ('in_warehouse', 'assigned') then
      raise exception 'Los estados de despacho y entrega solo pueden cambiarse mediante las operaciones autorizadas.'
        using errcode = '42501';
    end if;

    if new.status = 'in_warehouse' and public.pallet_in_active_order(old.id) then
      raise exception 'El pallet está en una orden: quitalo de la orden para devolverlo al depósito.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_direct_pallet_status() from public, anon, authenticated;
