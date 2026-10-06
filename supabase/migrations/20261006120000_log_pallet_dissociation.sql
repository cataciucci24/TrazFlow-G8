-- ============================================================================
-- Auditar la desasociación de pallets (extensión de US2)
-- ============================================================================
-- Hasta ahora dissociate_pallet_from_order no dejaba traceability_event, así
-- que el historial de una orden mostraba dos 'pallet_associated' seguidos del
-- mismo pallet sin nada en el medio, y no había forma de saber cuándo cambió
-- la composición de la orden. Ese dato es el que usa el panel de validación
-- de despacho para dar por superada una discrepancia 'wrong_order': si ese
-- mismo pallet se asoció o desasoció de la orden después del escaneo
-- incorrecto, la discrepancia queda en el historial pero deja de mostrarse
-- como inconsistencia activa (ver filterActiveDispatchDiscrepancies).
--
-- `alter type ... add value` no puede usarse dentro de la misma transacción
-- en la que se agrega; la función de abajo solo la referencia en su cuerpo
-- plpgsql (se resuelve al ejecutarse), así que no hay problema.

alter type event_type add value if not exists 'pallet_dissociated';

-- Misma función que 20260901130000_dissociate_pallet_from_order.sql, más el
-- insert del evento. Sigue siendo security definer (ver el motivo en esa
-- migración): el insert en traceability_events no pasa por RLS, así que se
-- scopea a mano con auth_company_id() como el resto de la función.
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

  delete from order_pallets relation
  where relation.order_id = p_order_id
    and relation.pallet_id = p_pallet_id;

  update pallets
  set status = 'in_warehouse'
  where id = p_pallet_id
    and company_id = auth_company_id()
  returning qr_code into v_qr_code;

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
