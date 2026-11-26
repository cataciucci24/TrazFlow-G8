-- TRZ-111: productores v2 completos, PENDIENTES DE LIBERACIÓN.
-- NO DESPLEGAR hasta integrar contrato/adaptadores de persona 2 y resolver
-- sus rechazos de observaciones con cantidad/unidad desconocidas.
-- No retira TM111. La prueba conjunta ensaya su retiro solo dentro de un rollback.
alter table public.order_pallets add column erp_dispatch_items jsonb;

create function public.erp_pallet_item_snapshot_v2(p_company_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.erp_pallet_items_v2(p_company_id, p_snapshot);
  select jsonb_agg(jsonb_build_object('productId', p.id, 'batchId', b.id,
    'productExternalId', btrim(p.external_id), 'lotExternalId', btrim(b.external_id),
    'productSku', p.sku, 'batchNumber', b.batch_number, 'quantity', x.quantity,
    'uom', coalesce(nullif(btrim(p.external_uom), ''), public.erp_outbox_default_uom(p.unit_of_measure)))
    order by b.id) into result
  from jsonb_to_recordset(p_snapshot) x("productId" uuid, "batchId" uuid, quantity numeric)
  join public.batches b on b.id=x."batchId" and b.company_id=p_company_id
  join public.products p on p.id=x."productId" and p.id=b.product_id and p.company_id=p_company_id;
  return result;
end;
$$;
revoke all on function public.erp_pallet_item_snapshot_v2(uuid,jsonb) from public,anon,authenticated,service_role;

-- El INSERT desde la API nunca puede anticipar el snapshot ERP confiable.
create function public.clear_erp_dispatch_snapshot_on_insert()
returns trigger language plpgsql set search_path = '' as $$
begin new.erp_dispatch_items := null; return new; end;
$$;
revoke all on function public.clear_erp_dispatch_snapshot_on_insert() from public,anon,authenticated,service_role;
create trigger trg_clear_erp_dispatch_snapshot before insert on public.order_pallets
  for each row execute function public.clear_erp_dispatch_snapshot_on_insert();

create or replace function public.erp_outbox_dispatch_payload(p_order_id uuid,p_operator_id uuid,p_dispatched_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare company uuid;
begin
  select company_id into company from public.dispatch_orders where id=p_order_id;
  update public.order_pallets op set erp_dispatch_items=public.erp_pallet_item_snapshot_v2(company,
    case when op.dispatch_items is null and jsonb_array_length(op.expected_items)=1 and op.validated_at is not null
      then op.expected_items else op.dispatch_items end)
    where op.order_id=p_order_id and op.expected and op.erp_dispatch_items is null;
  return public.erp_outbox_dispatch_payload_v2(p_order_id,p_operator_id,p_dispatched_at);
end;
$$;
revoke all on function public.erp_outbox_dispatch_payload(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.erp_pallet_scan_event(p_order_id uuid,p_pallet_id uuid,p_action text,p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  select expected_items into snapshot from public.order_pallets where order_id=p_order_id and pallet_id=p_pallet_id;
  perform public.erp_pallet_scan_event_v2(p_order_id,p_pallet_id,p_action,p_at,snapshot);
end;
$$;
revoke all on function public.erp_pallet_scan_event(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.enqueue_erp_pallet_scan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    if old.validated_at is not null then
      perform public.erp_pallet_scan_event_v2(old.order_id,old.pallet_id,'unscan',now(),old.expected_items);
    end if;
  elsif old.validated_at is null and new.validated_at is not null then
    perform public.erp_pallet_scan_event_v2(new.order_id,new.pallet_id,'scan',new.validated_at,new.expected_items);
  elsif old.validated_at is not null and new.validated_at is null then
    perform public.erp_pallet_scan_event_v2(new.order_id,new.pallet_id,'unscan',now(),old.expected_items);
  end if;
  return null;
end;
$$;
revoke all on function public.enqueue_erp_pallet_scan() from public,anon,authenticated,service_role;

-- Resuelve una observación sin inventar producto/lote, cantidad ni unidad.
-- Primero usa el catálogo congelado del despacho y después el catálogo de SU empresa.
create function public.erp_observed_item_v2(p_company_id uuid,p_observation jsonb,p_frozen jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare item jsonb; product public.products; lot public.batches; product_ext text; lot_ext text; unit text;
begin
  select x into item from jsonb_array_elements(p_frozen) x
    where x->>'productSku'=btrim(p_observation->>'productSku') and x->>'batchNumber'=btrim(p_observation->>'batchNumber') limit 1;
  if item is not null then
    product_ext:=item->>'productExternalId'; lot_ext:=item->>'lotExternalId'; unit:=item->>'uom';
  else
    select * into product from public.products where company_id=p_company_id and sku=btrim(p_observation->>'productSku');
    if found then
      select * into lot from public.batches where company_id=p_company_id and product_id=product.id and batch_number=btrim(p_observation->>'batchNumber');
      select x into item from jsonb_array_elements(p_frozen) x where x->>'productId'=product.id::text limit 1;
      product_ext:=coalesce(item->>'productExternalId',nullif(btrim(product.external_id),''));
      unit:=coalesce(item->>'uom',nullif(btrim(product.external_uom),''),public.erp_outbox_default_uom(product.unit_of_measure));
      select x into item from jsonb_array_elements(p_frozen) x where x->>'batchId'=lot.id::text limit 1;
      lot_ext:=coalesce(item->>'lotExternalId',nullif(btrim(lot.external_id),''));
    end if;
  end if;
  return jsonb_build_object('productExternalId',product_ext,'lotExternalId',lot_ext,
    'observedSku',p_observation->>'productSku','observedLot',p_observation->>'batchNumber',
    'quantity',p_observation->'quantity','uom',unit);
end;
$$;
revoke all on function public.erp_observed_item_v2(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.erp_content_differences_v2(p_order_id uuid,p_pallet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare op public.order_pallets; company uuid; frozen jsonb; observations jsonb; detected jsonb:='[]';
  differences jsonb:='[]'; expected jsonb; item jsonb; matched jsonb; position integer;
begin
  select * into op from public.order_pallets where order_id=p_order_id and pallet_id=p_pallet_id;
  select company_id into company from public.dispatch_orders where id=p_order_id;
  frozen:=coalesce(op.erp_dispatch_items,public.erp_pallet_item_snapshot_v2(company,coalesce(op.dispatch_items,op.expected_items)));
  select details->'detected_items' into observations from public.traceability_events
    where company_id=company and order_id=p_order_id and pallet_id=p_pallet_id and event_type='reception'
    order by created_at desc,id desc limit 1;
  if jsonb_typeof(observations) is distinct from 'array' then
    raise exception 'Faltan las observaciones originales de la recepción.' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(observations) loop
    detected:=detected||jsonb_build_array(public.erp_observed_item_v2(company,item,frozen));
  end loop;
  for expected in select value-'productId'-'batchId'-'productSku'-'batchNumber' from jsonb_array_elements(frozen) loop
    position:=null; matched:=null;
    select (ordinality-1)::integer,value into position,matched from jsonb_array_elements(detected) with ordinality
      where value->>'productExternalId'=expected->>'productExternalId' and value->>'lotExternalId'=expected->>'lotExternalId'
      order by ordinality limit 1;
    if position is not null then detected:=detected-position; end if;
    if matched is null or matched->'quantity'='0'::jsonb then
      differences:=differences||jsonb_build_array(jsonb_build_object('expected',expected,'detected',null));
    elsif matched->'quantity' is distinct from expected->'quantity' or matched->>'uom' is distinct from expected->>'uom' then
      differences:=differences||jsonb_build_array(jsonb_build_object('expected',expected,'detected',matched));
    end if;
  end loop;
  for item in select value from jsonb_array_elements(detected) loop
    differences:=differences||jsonb_build_array(jsonb_build_object('expected',null,'detected',item));
  end loop;
  return differences;
end;
$$;
revoke all on function public.erp_content_differences_v2(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.erp_outbox_delivery_payload(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('contractVersion',2,'idempotencyKey','delivery:'||btrim(o.external_id),
    'orderExternalId',btrim(o.external_id),'dispatchIdempotencyKey','dispatch:'||btrim(o.external_id),
    'deliveredAt',to_char(o.delivered_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'driver',jsonb_build_object('id',driver.id,'name',driver.name),
    'needsReview',o.status='delivered_with_discrepancy' or exists(select 1 from public.delivery_discrepancies d where d.order_id=o.id),
    'lines',coalesce((select jsonb_agg(jsonb_build_object('palletCode',p.qr_code,
      'outcome',case when op.delivery_outcome='content_mismatch' then 'delivered' else coalesce(op.delivery_outcome,'missing') end) order by p.qr_code)
      from public.order_pallets op join public.pallets p on p.id=op.pallet_id and p.company_id=o.company_id
      where op.order_id=o.id and op.expected),'[]'::jsonb),
    'discrepancies',coalesce((select jsonb_agg(jsonb_build_object('palletCode',d.reported_qr_code,'type',d.discrepancy_type)
      ||case when d.discrepancy_type='content_mismatch' then jsonb_build_object('contentDifferences',public.erp_content_differences_v2(o.id,d.pallet_id)) else '{}'::jsonb end
      order by d.reported_qr_code,d.discrepancy_type)
      from public.delivery_discrepancies d where d.order_id=o.id and d.company_id=o.company_id),'[]'::jsonb))
  from public.dispatch_orders o left join public.users driver on driver.id=coalesce(o.delivered_by,o.driver_id) and driver.company_id=o.company_id
  where o.id=p_order_id;
$$;
revoke all on function public.erp_outbox_delivery_payload(uuid) from public,anon,authenticated,service_role;

-- Snapshot persistido por despacho, también para consultas históricas.
create or replace function public.erp_outbox_dispatch_payload_v2(p_order_id uuid, p_operator_id uuid, p_dispatched_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.dispatch_orders; operator_name text; lines jsonb;
begin
  select * into o from public.dispatch_orders where id = p_order_id;
  if not found or nullif(btrim(o.external_id), '') is null then
    raise exception 'La orden no tiene identidad ERP.' using errcode = '22023';
  end if;
  select name into operator_name from public.users where id = p_operator_id and company_id = o.company_id;
  if not found then raise exception 'El operador no pertenece a la empresa.' using errcode = '42501'; end if;
  if exists (select 1 from public.order_pallets op join public.pallets p on p.id = op.pallet_id
    where op.order_id = o.id and op.expected and (p.company_id <> o.company_id or op.validated_at is null
      or (op.dispatch_items is distinct from op.expected_items
        and not(op.dispatch_items is null and jsonb_array_length(op.expected_items)=1)))) then
    raise exception 'Hay contenido sin validar en la orden.' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderLineExternalId', (select min(ol.external_id) from public.dispatch_order_lines ol
      join public.products pr on pr.id = ol.product_id and pr.company_id = o.company_id
      where ol.order_id = o.id and ((item ? 'productId' and pr.id::text=item->>'productId') or (not(item ? 'productId') and btrim(pr.external_id)=item->>'productExternalId')) having count(*) = 1),
    'palletCode', p.qr_code, 'productExternalId', item->>'productExternalId',
    'lotExternalId', item->>'lotExternalId', 'quantity', item->'quantity', 'uom', item->>'uom')
    order by p.qr_code, item->>'productExternalId', item->>'lotExternalId'), '[]'::jsonb) into lines
  from public.order_pallets op join public.pallets p on p.id = op.pallet_id and p.company_id = o.company_id
  cross join lateral jsonb_array_elements(coalesce(op.erp_dispatch_items, public.erp_pallet_items_v2(o.company_id, op.dispatch_items))) item
  where op.order_id = o.id and op.expected;
  if jsonb_array_length(lines) = 0 then raise exception 'La orden no tiene ítems para despachar.' using errcode = '22023'; end if;
  return jsonb_build_object('contractVersion', 2, 'idempotencyKey', 'dispatch:' || btrim(o.external_id),
    'orderExternalId', btrim(o.external_id),
    'dispatchedAt', to_char(p_dispatched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operator', jsonb_build_object('id', p_operator_id, 'name', operator_name), 'lines', lines);
end;
$$;
revoke all on function public.erp_outbox_dispatch_payload_v2(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;


-- Guardar recepción y auditoría ANTES de cerrar la orden y encolar.
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
  where pallet.qr_code = btrim(p_qr_code) and pallet.company_id = target_order.company_id for update;
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

  return query select 'delivered', target_pallet.id, target_pallet.qr_code,
    found_product_name, found_product_sku, found_batch_number, registered;
end;
$$;
revoke all on function public.confirm_delivery_pallet_legacy(uuid, text, text) from public, anon, service_role;
revoke all on function public.confirm_delivery_pallet_legacy(uuid, text, text) from public, anon, authenticated, service_role;


create or replace function public.confirm_delivery_pallet_items(p_order_id uuid, p_qr_code text, p_discrepancy_type text default null, p_items jsonb default null)
returns table (outcome text, pallet_id uuid, qr_code text, product_name text, product_sku text, batch_number text, registered_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare p public.pallets; relation public.order_pallets; observed jsonb; difference text := p_discrepancy_type; result record; driver uuid; pending_count integer; has_difference boolean;
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
    select count(*) into pending_count from public.order_pallets item
    where item.order_id = p_order_id and item.expected = true and item.delivery_outcome is null;
    if pending_count = 0 and exists(select 1 from public.dispatch_orders where id=p_order_id and status='confirmed') then
      select exists (
        select 1 from public.delivery_discrepancies difference where difference.order_id = p_order_id
      ) into has_difference;
      update public.dispatch_orders set
        status = case when has_difference then 'delivered_with_discrepancy'::public.order_status else 'delivered'::public.order_status end,
        delivered_at = result.registered_at,
        delivered_by = auth.uid()
      where id = p_order_id;
      if has_difference then
        insert into public.order_notifications (
          company_id, order_id, event_type, description, created_by, created_at
        ) values (
          p.company_id, p_order_id, 'delivery_closed_with_discrepancy',
          'La entrega fue cerrada con diferencias por el chofer asignado.', auth.uid(), result.registered_at
        );
      end if;
    end if;
  end if;
  return query select result.outcome, result.pallet_id, result.qr_code, result.product_name, result.product_sku, result.batch_number, result.registered_at;
end;
$$;
revoke all on function public.confirm_delivery_pallet_items(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.confirm_delivery_pallet_items(uuid, text, text, jsonb) to authenticated;


create or replace function public.register_delivery_receipt(p_order_id uuid, p_storage_path text, p_file_name text)
returns table (outcome text, receipt_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.dispatch_orders%rowtype;
  v_object storage.objects%rowtype;
  v_receipt public.order_delivery_receipts%rowtype;
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_name text := left(btrim(coalesce(p_file_name, '')), 200);
  v_type text;
  v_size bigint;
  v_count integer;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if p_order_id is null or v_path = '' or length(v_path) > 400 or v_name = '' then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select orders.* into v_order from public.dispatch_orders orders where orders.id = p_order_id for update;
  if not found or v_order.company_id is distinct from public.auth_company_id() then
    return query select 'order_not_found'::text, null::uuid;
    return;
  end if;
  if v_order.driver_id is distinct from auth.uid() then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if v_order.status not in ('confirmed', 'delivered', 'delivered_with_discrepancy') then
    return query select 'invalid_status'::text, null::uuid;
    return;
  end if;
  if v_path not like v_order.company_id::text || '/' || v_order.id::text || '/%'
     or v_path like '%/../%' or (storage.foldername(v_path))[3] is not null then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select receipt.* into v_receipt from public.order_delivery_receipts receipt where receipt.storage_path = v_path;
  if found then
    return query select 'already_registered'::text, v_receipt.id;
    return;
  end if;

  select object.* into v_object from storage.objects object
  where object.bucket_id = 'delivery-receipts' and object.name = v_path;
  if not found then
    return query select 'file_not_found'::text, null::uuid;
    return;
  end if;
  v_type := lower(v_object.metadata->>'mimetype');
  v_size := nullif(v_object.metadata->>'size', '')::bigint;
  if v_type is null
     or v_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')
     or v_size is null or v_size < 1 or v_size > 10485760 then
    return query select 'invalid_file'::text, null::uuid;
    return;
  end if;

  select count(*) into v_count from public.order_delivery_receipts receipt where receipt.order_id = v_order.id;
  if v_count >= public.delivery_receipts_max_per_order() then
    return query select 'limit_reached'::text, null::uuid;
    return;
  end if;

  insert into public.order_delivery_receipts (company_id, order_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
  values (v_order.company_id, v_order.id, v_path, v_name, v_type, v_size::integer, auth.uid())
  returning * into v_receipt;

  if v_order.external_id is not null then
    insert into public.erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
    values (
      v_order.company_id,
      'delivery_receipt_attached',
      v_receipt.id,
      'delivery-receipt:' || btrim(v_order.external_id) || ':' || v_receipt.id::text,
      jsonb_build_object(
        'contractVersion', 2,
        'idempotencyKey', 'delivery-receipt:' || btrim(v_order.external_id) || ':' || v_receipt.id::text,
        'orderExternalId', btrim(v_order.external_id),
        'dispatchIdempotencyKey', 'dispatch:' || btrim(v_order.external_id),
        'receiptId', v_receipt.id,
        'storagePath', v_receipt.storage_path,
        'fileName', v_receipt.file_name,
        'contentType', v_receipt.content_type,
        'sizeBytes', v_receipt.size_bytes,
        'uploadedAt', to_char(v_receipt.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'uploadedBy', jsonb_build_object('id', auth.uid(), 'name', (select u.name from public.users u where u.id = auth.uid()))
      ),
      auth.uid()
    )
    on conflict do nothing;
  end if;

  return query select 'registered'::text, v_receipt.id;
end;
$$;

revoke all on function public.register_delivery_receipt(uuid, text, text) from public, anon, service_role;
grant execute on function public.register_delivery_receipt(uuid, text, text) to authenticated;

