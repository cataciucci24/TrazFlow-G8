-- TRZ-111: esperado vs detectado por producto, lote y cantidad.
alter table public.order_pallets drop constraint order_pallets_delivery_outcome_check;
alter table public.order_pallets add constraint order_pallets_delivery_outcome_check
  check (delivery_outcome in ('delivered', 'missing', 'damaged', 'content_mismatch'));
alter table public.delivery_discrepancies drop constraint delivery_discrepancies_discrepancy_type_check;
alter table public.delivery_discrepancies add constraint delivery_discrepancies_discrepancy_type_check
  check (discrepancy_type in ('missing', 'surplus', 'damaged', 'wrong_order', 'content_mismatch'));

create function public.normalize_pallet_observations(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return null; end if;
  if jsonb_array_length(p_items) > 100 then return null; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'productSku') is distinct from 'string'
      or jsonb_typeof(x->'batchNumber') is distinct from 'string'
      or not (x ? 'quantity') or (x->'quantity' <> 'null'::jsonb and jsonb_typeof(x->'quantity') <> 'number')) then return null; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) x(quantity numeric)
    where x.quantity < 0 or x.quantity <> round(x.quantity, 2)) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('productId', product.id, 'batchId', batch.id, 'quantity', x.quantity)
    order by batch.id), '[]'::jsonb) into result
  from jsonb_to_recordset(p_items) x("productSku" text, "batchNumber" text, quantity numeric)
  left join public.products product on product.sku = btrim(x."productSku") and product.company_id = public.auth_company_id()
  left join public.batches batch on batch.product_id = product.id and batch.batch_number = btrim(x."batchNumber");
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$$;
revoke all on function public.normalize_pallet_observations(jsonb) from public, anon, authenticated, service_role;

create function public.validate_order_pallet_items(p_order_id uuid, p_qr_code text, p_items jsonb default null)
returns table (outcome text, pallet_id uuid, qr_code text, product_name text, product_sku text, batch_number text, validated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare p public.pallets; relation public.order_pallets; observed jsonb; result record;
begin
  if public.auth_role() is distinct from 'warehouse_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  perform 1 from public.dispatch_orders o where o.id = p_order_id and o.company_id = public.auth_company_id() and o.status = 'draft' for update;
  if not found then return query select 'order_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return; end if;
  select * into p from public.pallets where pallets.qr_code = btrim(p_qr_code) and company_id = public.auth_company_id() for update;
  select * into relation from public.order_pallets op where op.order_id = p_order_id and op.pallet_id = p.id and op.expected for update;
  if found then
    if p_items is null and jsonb_array_length(relation.expected_items) > 1 then
      return query select 'content_required', p.id, p.qr_code, null::text, null::text, null::text, null::timestamptz; return;
    end if;
    observed := case when p_items is null then relation.expected_items else public.normalize_pallet_observations(p_items) end;
    if observed is null or observed <> relation.expected_items or public.pallet_content_snapshot(p.id) <> relation.expected_items then
      update public.order_pallets op set dispatch_items = null, validated_at = null,
        validated_by = null, detected_at_dispatch = false where op.order_id = p_order_id and op.pallet_id = p.id;
      insert into public.traceability_events(company_id, pallet_id, order_id, event_type, user_id, details)
        values (p.company_id, p.id, p_order_id, 'dispatch_discrepancy', auth.uid(),
          jsonb_build_object('type', 'content_mismatch', 'qr_code', p.qr_code, 'expected_items', relation.expected_items, 'detected_items', p_items));
      return query select 'content_mismatch', p.id, p.qr_code, null::text, null::text, null::text, null::timestamptz; return;
    end if;
  end if;
  select * into result from public.validate_order_pallet_legacy(p_order_id, p_qr_code);
  if result.outcome = 'validated' then
    update public.order_pallets op set dispatch_items = observed where op.order_id = p_order_id and op.pallet_id = p.id;
  end if;
  return query select result.outcome, result.pallet_id, result.qr_code, result.product_name, result.product_sku, result.batch_number, result.validated_at;
end;
$$;
revoke all on function public.validate_order_pallet_items(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.validate_order_pallet_items(uuid, text, jsonb) to authenticated;

create or replace function public.validate_order_pallet(p_order_id uuid, p_qr_code text)
returns table (outcome text, pallet_id uuid, qr_code text, product_name text, product_sku text, batch_number text, validated_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from public.validate_order_pallet_items(p_order_id, p_qr_code, null);
$$;

create function public.confirm_delivery_pallet_items(p_order_id uuid, p_qr_code text, p_discrepancy_type text default null, p_items jsonb default null)
returns table (outcome text, pallet_id uuid, qr_code text, product_name text, product_sku text, batch_number text, registered_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare p public.pallets; relation public.order_pallets; observed jsonb; difference text := p_discrepancy_type; result record; driver uuid;
begin
  if public.auth_role() is distinct from 'driver_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  select o.driver_id into driver from public.dispatch_orders o where o.id = p_order_id
    and o.company_id = public.auth_company_id() for update;
  if not found then return query select 'order_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return; end if;
  if driver is distinct from auth.uid() then return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return; end if;
  select * into p from public.pallets where pallets.qr_code = btrim(p_qr_code) and company_id = public.auth_company_id() for update;
  select * into relation from public.order_pallets op where op.order_id = p_order_id and op.pallet_id = p.id and op.expected for update;
  if found and relation.delivery_outcome is null then
    if p_items is null and jsonb_array_length(relation.expected_items) > 1 and difference is distinct from 'missing' then
      return query select 'content_required', p.id, p.qr_code, null::text, null::text, null::text, null::timestamptz; return;
    end if;
    observed := case when difference = 'missing' then '[]'::jsonb when p_items is null then relation.expected_items else public.normalize_pallet_observations(p_items) end;
    if observed is null then
      return query select 'invalid_input', p.id, p.qr_code, null::text, null::text, null::text, null::timestamptz; return;
    end if;
    if observed <> relation.expected_items and difference is distinct from 'missing' then difference := 'content_mismatch'; end if;
  end if;
  select * into result from public.confirm_delivery_pallet_legacy(p_order_id, p_qr_code, difference);
  if result.outcome = 'delivered' then
    update public.order_pallets op set reception_items = observed where op.order_id = p_order_id and op.pallet_id = p.id;
    insert into public.traceability_events(company_id, pallet_id, order_id, event_type, user_id, details)
      values (p.company_id, p.id, p_order_id, 'reception', auth.uid(),
        jsonb_build_object('expected_items', relation.expected_items, 'detected_items', p_items, 'normalized_items', observed, 'reported_discrepancy', p_discrepancy_type, 'outcome', coalesce(difference, 'delivered')));
  end if;
  return query select result.outcome, result.pallet_id, result.qr_code, result.product_name, result.product_sku, result.batch_number, result.registered_at;
end;
$$;
revoke all on function public.confirm_delivery_pallet_items(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.confirm_delivery_pallet_items(uuid, text, text, jsonb) to authenticated;

create or replace function public.confirm_delivery_pallet(p_order_id uuid, p_qr_code text, p_discrepancy_type text default null)
returns table (outcome text, pallet_id uuid, qr_code text, product_name text, product_sku text, batch_number text, registered_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from public.confirm_delivery_pallet_items(p_order_id, p_qr_code, p_discrepancy_type, null);
$$;

create or replace function validate_order_pallet_legacy(
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
security definer
set search_path = public
as $$
declare
  v_pallet pallets%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_product_name text;
  v_product_sku text;
  v_batch_number text;
  v_validated_at timestamptz := now();
  v_round integer;
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

  select string_agg(c.product_name, ' · ' order by c.item_id), string_agg(c.product_sku, ' · ' order by c.item_id), string_agg(c.batch_number, ' · ' order by c.item_id)
    into v_product_name, v_product_sku, v_batch_number from public.pallet_contents c where c.pallet_id = v_pallet.id;

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

  -- TRZ-100: ronda de este escaneo (la fila de order_pallets está bloqueada desde arriba).
  select count(*) + 1
    into v_round
  from traceability_events event
  where event.order_id = p_order_id
    and event.pallet_id = v_pallet.id
    and event.event_type = 'qr_scan';

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
    jsonb_build_object('qr_code', v_pallet.qr_code, 'validation_round', v_round),
    v_validated_at
  );

  return query select 'validated', v_pallet.id, v_pallet.qr_code,
    v_product_name, v_product_sku, v_batch_number, v_validated_at;
end;
$$;

revoke all on function validate_order_pallet_legacy(uuid, text) from public;
revoke all on function validate_order_pallet_legacy(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.confirm_delivery_pallet_legacy(
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
  if normalized_difference is not null and normalized_difference not in ('missing', 'surplus', 'damaged', 'wrong_order', 'content_mismatch') then
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

  select string_agg(c.product_name, ' · ' order by c.item_id), string_agg(c.product_sku, ' · ' order by c.item_id), string_agg(c.batch_number, ' · ' order by c.item_id)
    into found_product_name, found_product_sku, found_batch_number from public.pallet_contents c where c.pallet_id = target_pallet.id;

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
revoke all on function public.confirm_delivery_pallet_legacy(uuid, text, text) from public, anon, service_role;
revoke all on function public.confirm_delivery_pallet_legacy(uuid, text, text) from public, anon, authenticated, service_role;

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
  v_mismatched integer;
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

  -- TRZ-100: pedido vs. armado, solo para órdenes del ERP con líneas.
  if v_order.external_id is not null
     and exists (select 1 from dispatch_order_lines line where line.order_id = p_order_id) then
    select count(*)
      into v_mismatched
    from (
      select line.product_id, sum(line.quantity) as requested
      from dispatch_order_lines line
      where line.order_id = p_order_id
      group by line.product_id
    ) requested
    full join (
      select content.product_id, sum(coalesce(content.quantity, 0)) as built
      from order_pallets relation
      join public.pallet_contents content on content.pallet_id = relation.pallet_id
      where relation.order_id = p_order_id
        and relation.expected = true
      group by content.product_id
    ) built on built.product_id = requested.product_id
    where round(coalesce(requested.requested, 0), 2) <> round(coalesce(built.built, 0), 2);

    if v_mismatched > 0 then
      return query select 'quantity_mismatch', v_order.id, v_order.status::text,
        null::timestamptz, null::integer;
      return;
    end if;
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

-- Nadie puede confirmar directamente una validación sin comparar el contenido.
update public.order_pallets set dispatch_items = expected_items where validated_at is not null and dispatch_items is null;
create function public.guard_dispatch_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.external_id is not null and exists (
      select 1 from public.order_pallets op where op.order_id = new.id and op.expected and jsonb_array_length(op.expected_items) > 1
    ) then raise exception 'Integración ERP de pallets mixtos pendiente de ola 2.' using errcode = 'TM111'; end if;
    if exists (select 1 from public.order_pallets op where op.order_id = new.id and op.expected
      and ((jsonb_array_length(op.expected_items) > 1 and op.dispatch_items is distinct from op.expected_items) or public.pallet_content_snapshot(op.pallet_id) <> op.expected_items)) then
      raise exception 'Hay ítems pendientes de validar o el contenido cambió. Volvé a escanear.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dispatch_content() from public, anon, authenticated, service_role;
create trigger trg_guard_dispatch_content before update of status on public.dispatch_orders
  for each row execute function public.guard_dispatch_content();

-- Leer la validación antes del puente de contenido que la invalida.
create or replace function public.update_assigned_pallet_quantity(p_pallet_id uuid, p_quantity numeric)
returns table (
  outcome text,
  pallet_id uuid,
  qr_code text,
  order_id uuid,
  validation_cleared boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pallet public.pallets%rowtype;
  v_unit text;
  v_order_id uuid;
  v_validated_at timestamptz;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'logistics_manager' then
    return query select 'forbidden', null::uuid, null::text, null::uuid, false;
    return;
  end if;

  -- Primero la orden (mismo orden de locks que confirm_dispatch_order: orden y después pallets).
  select relation.order_id into v_order_id
  from public.order_pallets relation
  join public.dispatch_orders orders on orders.id = relation.order_id
  where relation.pallet_id = p_pallet_id
    and relation.expected = true
    and orders.company_id = public.auth_company_id()
    and orders.status = 'draft';

  if v_order_id is not null then
    perform 1 from public.dispatch_orders orders where orders.id = v_order_id for update;
  end if;

  select * into v_pallet
  from public.pallets pallet
  where pallet.id = p_pallet_id
    and pallet.company_id = public.auth_company_id()
  for update;

  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::uuid, false;
    return;
  end if;

  -- Revalidado con los locks tomados: la orden sigue en borrador y el pallet sigue asignado a ella.
  if v_order_id is null or v_pallet.status <> 'assigned' or not exists (
    select 1
    from public.order_pallets relation
    join public.dispatch_orders orders on orders.id = relation.order_id
    where relation.order_id = v_order_id and relation.pallet_id = p_pallet_id
      and relation.expected = true and orders.status = 'draft'
  ) then
    return query select 'not_assigned', v_pallet.id, v_pallet.qr_code, null::uuid, false;
    return;
  end if;

  if v_pallet.source_system is distinct from 'trazflow' or (select count(*) from public.pallet_items i where i.pallet_id = v_pallet.id) > 1 then
    return query select 'not_editable', v_pallet.id, v_pallet.qr_code, v_order_id, false;
    return;
  end if;

  select product.unit_of_measure into v_unit
  from public.batches batch
  join public.products product on product.id = batch.product_id
  where batch.id = v_pallet.batch_id;

  if public.erp_sync_quantity_problem(p_quantity, v_unit, false) is not null then
    return query select 'invalid_quantity', v_pallet.id, v_pallet.qr_code, v_order_id, false;
    return;
  end if;

  -- Guardar sin cambiar la cantidad no borra la validación.
  if v_pallet.quantity = p_quantity then
    return query select 'unchanged', v_pallet.id, v_pallet.qr_code, v_order_id, false;
    return;
  end if;

  select relation.validated_at into v_validated_at
  from public.order_pallets relation
  where relation.order_id = v_order_id and relation.pallet_id = v_pallet.id;

  update public.pallets set quantity = p_quantity where id = v_pallet.id;

  if v_validated_at is not null then
    update public.order_pallets
    set validated_at = null,
        validated_by = null,
        detected_at_dispatch = false
    where order_pallets.order_id = v_order_id and order_pallets.pallet_id = v_pallet.id;
  end if;

  return query select 'updated', v_pallet.id, v_pallet.qr_code, v_order_id, v_validated_at is not null;
end;
$$;

revoke all on function public.update_assigned_pallet_quantity(uuid, numeric) from public, anon;
grant execute on function public.update_assigned_pallet_quantity(uuid, numeric) to authenticated;

create or replace function public.get_order_delivery_pallets(p_order_id uuid)
returns table (
  pallet_id uuid, qr_code text, product_name text, product_sku text,
  batch_number text, quantity numeric, unit_of_measure text,
  delivery_outcome text, processed_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then return; end if;
  if not exists (
    select 1 from public.dispatch_orders orders
    where orders.id = p_order_id and orders.driver_id = auth.uid()
  ) then return; end if;

  return query
  select pallet.id, pallet.qr_code, product.name, product.sku,
    batch.batch_number, observed.quantity, product.unit_of_measure::text,
    relation.delivery_outcome, relation.delivered_at
  from public.order_pallets relation
  join public.pallets pallet on pallet.id = relation.pallet_id
  cross join lateral jsonb_to_recordset(relation.expected_items) observed("productId" uuid, "batchId" uuid, quantity numeric)
  join public.batches batch on batch.id = observed."batchId"
  join public.products product on product.id = observed."productId" and product.id = batch.product_id and product.company_id = pallet.company_id
  where relation.order_id = p_order_id and relation.expected = true
  order by pallet.qr_code;
end;
$$;
revoke all on function public.get_order_delivery_pallets(uuid) from public, anon, service_role;
grant execute on function public.get_order_delivery_pallets(uuid) to authenticated;


