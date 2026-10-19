-- US-OPS-07: confirm_delivery_pallet fallaba con `column reference "pallet_id" is ambiguous`.
-- La columna pallet_id que devuelve la función (returns table) choca, dentro de PL/pgSQL, con
-- `on conflict (order_id, pallet_id, discrepancy_type)`. Se nombra la restricción única en su lugar
-- (es la misma: unique (order_id, pallet_id, discrepancy_type) de delivery_discrepancies).
-- El resto de la función, su firma y sus permisos son idénticos a 20261013235100_driver_delivery_workflow.sql.

create or replace function public.confirm_delivery_pallet(
  p_order_id uuid,
  p_qr_code text,
  p_discrepancy_type text default null
)
returns table (
  outcome text, pallet_id uuid, qr_code text, product_name text,
  product_sku text, batch_number text, registered_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
declare
  target_order public.dispatch_orders%rowtype;
  target_pallet public.pallets%rowtype;
  relation public.order_pallets%rowtype;
  destination_name text;
  found_product_name text;
  found_product_sku text;
  found_batch_number text;
  registered timestamptz := now();
  pending_count integer;
  has_difference boolean;
  normalized_difference text := p_discrepancy_type;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if p_order_id is null or p_qr_code is null or btrim(p_qr_code) = '' or length(btrim(p_qr_code)) > 512 then
    return query select 'invalid_input', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if normalized_difference is not null and normalized_difference not in ('missing', 'surplus', 'damaged', 'wrong_order') then
    return query select 'invalid_discrepancy_type', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select orders.* into target_order from public.dispatch_orders orders
  where orders.id = p_order_id for update;
  if not found then
    return query select 'order_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if target_order.driver_id is distinct from auth.uid() then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if target_order.status not in ('confirmed', 'delivered', 'delivered_with_discrepancy') then
    return query select 'invalid_status', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.* into target_pallet from public.pallets pallet
  where pallet.qr_code = btrim(p_qr_code) for update;
  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select product.name, product.sku, batch.batch_number
    into found_product_name, found_product_sku, found_batch_number
  from public.batches batch join public.products product on product.id = batch.product_id
  where batch.id = target_pallet.batch_id;

  select item.* into relation from public.order_pallets item
  where item.order_id = p_order_id and item.pallet_id = target_pallet.id and item.expected = true
  for update;

  if not found then
    if target_order.status <> 'confirmed' then
      return query select 'invalid_status', target_pallet.id, target_pallet.qr_code,
        found_product_name, found_product_sku, found_batch_number, null::timestamptz;
      return;
    end if;
    normalized_difference := coalesce(normalized_difference, 'wrong_order');
    if normalized_difference not in ('surplus', 'wrong_order') then normalized_difference := 'wrong_order'; end if;
    insert into public.delivery_discrepancies (
      company_id, order_id, pallet_id, reported_qr_code, discrepancy_type, driver_id, created_at
    ) values (
      target_order.company_id, target_order.id, target_pallet.id, target_pallet.qr_code,
      normalized_difference, auth.uid(), registered
    ) on conflict on constraint delivery_discrepancies_order_id_pallet_id_discrepancy_type_key do nothing;
    if found then
      insert into public.traceability_events (
        company_id, pallet_id, order_id, event_type, user_id, details, created_at
      ) values (
        target_order.company_id, target_pallet.id, target_order.id, 'delivery_discrepancy',
        auth.uid(), jsonb_build_object('type', normalized_difference, 'qr_code', target_pallet.qr_code), registered
      );
      return query select case when normalized_difference = 'surplus' then 'surplus_recorded' else 'wrong_order' end,
        target_pallet.id, target_pallet.qr_code, found_product_name, found_product_sku, found_batch_number, registered;
    else
      return query select 'already_processed', target_pallet.id, target_pallet.qr_code,
        found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    end if;
    return;
  end if;

  if relation.delivery_outcome is not null then
    return query select 'already_processed', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, relation.delivered_at;
    return;
  end if;
  if target_order.status <> 'confirmed' then
    return query select 'invalid_status', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    return;
  end if;
  if normalized_difference in ('surplus', 'wrong_order') then
    return query select 'invalid_discrepancy_type', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    return;
  end if;
  if target_pallet.status <> 'in_transit' then
    return query select 'invalid_pallet_status', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    return;
  end if;

  select recipient.name into destination_name from public.distributors recipient
  where recipient.id = target_order.distributor_id;

  update public.order_pallets item set
    delivery_outcome = case when normalized_difference is null then 'delivered' else normalized_difference end,
    delivered_at = registered,
    delivered_by = auth.uid()
  where item.order_id = p_order_id and item.pallet_id = target_pallet.id;

  update public.pallets pallet set
    status = case when normalized_difference is null then 'delivered'::public.pallet_status else 'delivery_discrepancy'::public.pallet_status end,
    current_location = case when normalized_difference = 'missing' then pallet.current_location else destination_name end
  where pallet.id = target_pallet.id;

  if normalized_difference is distinct from 'missing' then
    insert into public.movements (
      pallet_id, order_id, origin_location, destination_location, resulting_status, user_id, created_at
    ) values (
      target_pallet.id, target_order.id, target_pallet.current_location, destination_name,
      case when normalized_difference is null then 'delivered'::public.pallet_status else 'delivery_discrepancy'::public.pallet_status end,
      auth.uid(), registered
    );
  end if;

  insert into public.traceability_events (
    company_id, pallet_id, order_id, event_type, user_id, details, created_at
  ) values (
    target_order.company_id, target_pallet.id, target_order.id, 'delivery_confirmed', auth.uid(),
    jsonb_build_object('qr_code', target_pallet.qr_code, 'outcome', coalesce(normalized_difference, 'delivered'),
      'recipient_id', target_order.distributor_id), registered
  );

  if normalized_difference is not null then
    insert into public.delivery_discrepancies (
      company_id, order_id, pallet_id, reported_qr_code, discrepancy_type, driver_id, created_at
    ) values (
      target_order.company_id, target_order.id, target_pallet.id, target_pallet.qr_code,
      normalized_difference, auth.uid(), registered
    );
    insert into public.traceability_events (
      company_id, pallet_id, order_id, event_type, user_id, details, created_at
    ) values (
      target_order.company_id, target_pallet.id, target_order.id, 'delivery_discrepancy', auth.uid(),
      jsonb_build_object('type', normalized_difference, 'qr_code', target_pallet.qr_code), registered
    );
  end if;

  select count(*) into pending_count from public.order_pallets item
  where item.order_id = target_order.id and item.expected = true and item.delivery_outcome is null;
  if pending_count = 0 then
    select exists (
      select 1 from public.delivery_discrepancies difference where difference.order_id = target_order.id
    ) into has_difference;
    update public.dispatch_orders set
      status = case when has_difference then 'delivered_with_discrepancy'::public.order_status else 'delivered'::public.order_status end,
      delivered_at = registered,
      delivered_by = auth.uid()
    where id = target_order.id;
    if has_difference then
      insert into public.order_notifications (
        company_id, order_id, event_type, description, created_by, created_at
      ) values (
        target_order.company_id, target_order.id, 'delivery_closed_with_discrepancy',
        'La entrega fue cerrada con diferencias por el chofer asignado.', auth.uid(), registered
      );
    end if;
  end if;

  return query select 'delivered', target_pallet.id, target_pallet.qr_code,
    found_product_name, found_product_sku, found_batch_number, registered;
end;
$$;
revoke all on function public.confirm_delivery_pallet(uuid, text, text) from public, anon, service_role;
grant execute on function public.confirm_delivery_pallet(uuid, text, text) to authenticated;
