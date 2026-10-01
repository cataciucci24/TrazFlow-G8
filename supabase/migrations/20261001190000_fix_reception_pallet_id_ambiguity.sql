-- Corrige la ambigüedad entre la columna `order_pallets.pallet_id` y el
-- parámetro de salida homónimo del RPC de recepción ya desplegado.
-- La migración original queda corregida para instalaciones nuevas; se vuelve
-- a declarar la función para reparar también las bases ya migradas.
create or replace function receive_order_pallet(
  p_order_id uuid,
  p_qr_code text,
  p_discrepancy_type text
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
  v_has_discrepancy boolean;
begin
  if auth.uid() is null or auth_role() is distinct from 'distributor_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_order_id is null or p_qr_code is null or btrim(p_qr_code) = '' or length(btrim(p_qr_code)) > 512 then
    return query select 'invalid_input', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_discrepancy_type is not null and p_discrepancy_type not in ('missing', 'surplus', 'damaged', 'wrong_order') then
    return query select 'invalid_discrepancy_type', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select orders.* into v_order from dispatch_orders orders where orders.id = p_order_id for update;
  if not found then
    return query select 'order_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not operates_for_distributor(v_order.distributor_id) then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_order.status not in ('confirmed', 'received', 'received_with_discrepancy') then
    return query select 'invalid_status', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.* into v_pallet from pallets pallet where pallet.qr_code = btrim(p_qr_code) for update;
  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select relation.* into v_order_pallet from order_pallets relation
  where relation.order_id = p_order_id and relation.pallet_id = v_pallet.id and relation.expected = true for update;
  if not found then
    insert into traceability_events (company_id, pallet_id, order_id, event_type, user_id, details, created_at)
    values (v_order.company_id, v_pallet.id, p_order_id, 'reception_discrepancy', auth.uid(), jsonb_build_object('type', 'wrong_order', 'qr_code', v_pallet.qr_code), v_registered_at);
    insert into order_notifications (company_id, order_id, pallet_id, event_type, description, created_by, created_at)
    values (v_order.company_id, p_order_id, v_pallet.id, 'reception_wrong_pallet', format('Se intentó recibir el pallet %s, que no pertenece a esta orden de despacho.', v_pallet.qr_code), auth.uid(), v_registered_at);
    return query select 'wrong_order', v_pallet.id, v_pallet.qr_code, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select product.name, product.sku, batch.batch_number into v_product_name, v_product_sku, v_batch_number
  from batches batch join products product on product.id = batch.product_id where batch.id = v_pallet.batch_id;
  if v_order_pallet.received then
    return query select 'already_received', v_pallet.id, v_pallet.qr_code, v_product_name, v_product_sku, v_batch_number, null::timestamptz;
    return;
  end if;
  if v_pallet.status <> 'in_transit' then
    return query select 'invalid_pallet_status', v_pallet.id, v_pallet.qr_code, v_product_name, v_product_sku, v_batch_number, null::timestamptz;
    return;
  end if;

  select distributor.name into v_destination from distributors distributor where distributor.id = v_order.distributor_id;
  update order_pallets relation set received = true where relation.order_id = p_order_id and relation.pallet_id = v_pallet.id;
  update pallets set status = case when p_discrepancy_type is null then 'received'::pallet_status else 'discrepancy'::pallet_status end, current_location = v_destination where id = v_pallet.id;
  insert into movements (pallet_id, order_id, origin_location, destination_location, resulting_status, user_id, created_at)
  values (v_pallet.id, p_order_id, v_pallet.current_location, v_destination, case when p_discrepancy_type is null then 'received'::pallet_status else 'discrepancy'::pallet_status end, auth.uid(), v_registered_at);
  insert into traceability_events (company_id, pallet_id, order_id, event_type, user_id, details, created_at)
  values (v_order.company_id, v_pallet.id, p_order_id, 'reception', auth.uid(), jsonb_build_object('qr_code', v_pallet.qr_code, 'distributor_id', v_order.distributor_id, 'destination_location', v_destination), v_registered_at);

  if p_discrepancy_type is not null then
    insert into traceability_events (company_id, pallet_id, order_id, event_type, user_id, details, created_at)
    values (v_order.company_id, v_pallet.id, p_order_id, 'reception_discrepancy', auth.uid(), jsonb_build_object('type', p_discrepancy_type, 'qr_code', v_pallet.qr_code), v_registered_at);
    insert into order_notifications (company_id, order_id, pallet_id, event_type, description, created_by, created_at)
    values (v_order.company_id, p_order_id, v_pallet.id, 'reception_reported_discrepancy', format('El pallet %s fue recibido con discrepancia: %s.', v_pallet.qr_code, case p_discrepancy_type when 'missing' then 'faltante' when 'surplus' then 'sobrante' when 'damaged' then 'dañado' else 'no corresponde al pedido' end), auth.uid(), v_registered_at);
  end if;

  select count(*) into v_pending_count from order_pallets relation where relation.order_id = p_order_id and relation.expected = true and relation.received = false;
  if v_pending_count = 0 then
    select exists (select 1 from traceability_events event where event.order_id = p_order_id and event.event_type = 'reception_discrepancy') into v_has_discrepancy;
    update dispatch_orders set status = case when v_has_discrepancy then 'received_with_discrepancy'::order_status else 'received'::order_status end, received_at = v_registered_at where id = p_order_id;
  end if;

  return query select 'received', v_pallet.id, v_pallet.qr_code, v_product_name, v_product_sku, v_batch_number, v_registered_at;
end;
$$;
