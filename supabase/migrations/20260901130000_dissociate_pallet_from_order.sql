-- ============================================================================
-- US2 (extensión): desasociar un pallet de una orden de despacho
-- ============================================================================
-- Solo logistics_manager, y solo mientras la orden esté en 'draft' (mismo
-- criterio que ya usa canAssociate en el frontend) y el pallet todavía no
-- haya sido validado (order_pallets.validated_at is null). Una vez que el
-- operador de depósito lo escaneó (US3), sacarlo de la orden dejaría un
-- evento qr_scan huérfano y un estado inconsistente con lo que ya se
-- verificó en el piso.
--
-- No se registra traceability_event para esta acción: a diferencia de
-- asociar/validar/confirmar, desasociar revierte una asociación que todavía
-- no tuvo ningún efecto físico verificado (el pallet nunca salió del
-- depósito ni fue escaneado), así que no hay nada que auditar más allá del
-- propio DELETE en order_pallets.

-- No existía ninguna policy de DELETE sobre order_pallets hasta ahora.
create policy order_pallets_delete_manager on order_pallets
  for delete using (
    auth_role() = 'logistics_manager'
    and order_belongs_to_auth_company(order_id)
  );

-- security definer (no invoker, a diferencia de confirm_dispatch_order):
-- ninguna policy de UPDATE sobre dispatch_orders ni order_pallets admite a
-- logistics_manager (son de warehouse_operator, de US3/US5), y Postgres
-- exige que un `for update`/`for share` también satisfaga la policy de
-- UPDATE de la tabla, no solo la de SELECT — con invoker, el lock
-- simplemente no encontraba la fila (0 rows) aunque la policy de SELECT sí
-- la dejara ver. Mismo motivo por el que order_belongs_to_auth_company /
-- pallet_belongs_to_auth_company (US3) ya son security definer. Como acá
-- RLS queda bypaseado, toda la autorización la hace la función a mano
-- (chequeo de rol + scoping manual por company_id en cada query).
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

  delete from order_pallets relation
  where relation.order_id = p_order_id
    and relation.pallet_id = p_pallet_id;

  update pallets
  set status = 'in_warehouse'
  where id = p_pallet_id
    and company_id = auth_company_id();

  return query select 'dissociated', v_order.id, p_pallet_id;
end;
$$;

revoke all on function dissociate_pallet_from_order(uuid, uuid) from public;
grant execute on function dissociate_pallet_from_order(uuid, uuid) to authenticated;
