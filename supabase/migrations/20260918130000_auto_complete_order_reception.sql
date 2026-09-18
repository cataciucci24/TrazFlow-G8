-- ============================================================================
-- US6 (fix): transicionar la orden a 'received' cuando termina la recepción
-- ============================================================================
-- `receive_order_pallet` marcaba `order_pallets.received` y `pallets.status`
-- pero nunca tocaba `dispatch_orders.status`, que quedaba pegado en
-- 'confirmed' para siempre. El distribuidor terminaba de escanear todos los
-- pallets esperados y la orden seguía viéndose como "en tránsito" en todos
-- lados salvo en el badge local (derivado, no de `order.status`) del panel
-- de recepción. `received_at` ya existía en el schema sin usarse: este era
-- el enganche pendiente.
--
-- Regla: al confirmar la recepción de un pallet, si ya no queda ningún
-- `order_pallets` esperado (`expected = true`) con `received = false` para
-- esa orden, la orden pasa a 'received' y se completa `received_at`.
--
-- Fuera de alcance: 'received_with_discrepancy' no se asigna acá. Hoy no
-- existe ninguna acción por la que el distribuidor pueda cerrar una orden
-- con pallets faltantes (a diferencia de US5, que sí bloquea la confirmación
-- de despacho con pallets sin validar). Asignar ese estado automáticamente
-- requeriría antes una forma explícita de que el distribuidor reporte
-- faltantes/discrepancias de recepción, que no está implementada.

create or replace function receive_order_pallet(
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
  registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order dispatch_orders%rowtype;
  v_pallet pallets%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_destination text;
  v_product_name text;
  v_product_sku text;
  v_batch_number text;
  v_registered_at timestamptz := now();
  v_pending_count integer;
begin
  if auth.uid() is null or auth_role() is distinct from 'distributor_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_order_id is null
     or p_qr_code is null
     or btrim(p_qr_code) = ''
     or length(btrim(p_qr_code)) > 512 then
    return query select 'invalid_input', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select orders.*
    into v_order
  from dispatch_orders orders
  where orders.id = p_order_id
  for update;

  if not found then
    return query select 'order_not_found', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if not operates_for_distributor(v_order.distributor_id) then
    return query select 'forbidden', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Una orden 'received' solo pudo llegar a ese estado con todos sus pallets
  -- esperados ya recibidos, así que se sigue permitiendo el flujo (un QR
  -- válido de esa orden siempre terminará en 'already_received') para que
  -- un reintento idempotente del último escaneo no se rompa con
  -- 'invalid_status'.
  if v_order.status not in ('confirmed', 'received') then
    return query select 'invalid_status', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.*
    into v_pallet
  from pallets pallet
  where pallet.qr_code = btrim(p_qr_code)
  for update;

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
    and relation.expected = true
  for update;

  if not found then
    return query select 'wrong_order', v_pallet.id, v_pallet.qr_code,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select product.name, product.sku, batch.batch_number
    into v_product_name, v_product_sku, v_batch_number
  from batches batch
  join products product on product.id = batch.product_id
  where batch.id = v_pallet.batch_id;

  if v_order_pallet.received then
    return query select 'already_received', v_pallet.id, v_pallet.qr_code,
      v_product_name, v_product_sku, v_batch_number, null::timestamptz;
    return;
  end if;

  if v_pallet.status <> 'in_transit' then
    return query select 'invalid_pallet_status', v_pallet.id, v_pallet.qr_code,
      v_product_name, v_product_sku, v_batch_number, null::timestamptz;
    return;
  end if;

  select distributor.name
    into v_destination
  from distributors distributor
  where distributor.id = v_order.distributor_id;

  update order_pallets relation
  set received = true
  where relation.order_id = p_order_id
    and relation.pallet_id = v_pallet.id;

  update pallets pallet
  set status = 'received',
      current_location = v_destination
  where pallet.id = v_pallet.id;

  insert into movements (
    pallet_id,
    order_id,
    origin_location,
    destination_location,
    resulting_status,
    user_id,
    created_at
  ) values (
    v_pallet.id,
    p_order_id,
    v_pallet.current_location,
    v_destination,
    'received',
    auth.uid(),
    v_registered_at
  );

  insert into traceability_events (
    company_id,
    pallet_id,
    order_id,
    event_type,
    user_id,
    details,
    created_at
  ) values (
    v_order.company_id,
    v_pallet.id,
    p_order_id,
    'reception',
    auth.uid(),
    jsonb_build_object(
      'qr_code', v_pallet.qr_code,
      'distributor_id', v_order.distributor_id,
      'destination_location', v_destination
    ),
    v_registered_at
  );

  -- Si ya no queda ningún pallet esperado sin recibir, la orden se completa.
  select count(*)
    into v_pending_count
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.expected = true
    and relation.received = false;

  if v_pending_count = 0 then
    update dispatch_orders
    set status = 'received',
        received_at = v_registered_at
    where id = p_order_id;
  end if;

  return query select 'received', v_pallet.id, v_pallet.qr_code,
    v_product_name, v_product_sku, v_batch_number, v_registered_at;
end;
$$;

revoke all on function receive_order_pallet(uuid, text) from public;
grant execute on function receive_order_pallet(uuid, text) to authenticated;
