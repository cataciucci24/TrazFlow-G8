-- TRZ-111, ola 2: preparación de productores v2 sobre TRZ-112.
-- No activa v2 ni retira TM111: los wrappers actuales siguen emitiendo v1.
-- Activar los productores requiere el contrato/adaptadores de persona 2 y
-- completar la representación de diferencias de recepción (0/null/unidad desconocida).

-- Resuelve un snapshot local dentro de SU empresa y congela sus IDs/unidades ERP.
-- Nunca usa el encabezado monolote ni el contenido actual del pallet.
create function public.erp_pallet_items_v2(p_company_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'array' or jsonb_array_length(p_snapshot) = 0 then
    raise exception 'Falta el contenido histórico del pallet.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_snapshot) x("productId" uuid, "batchId" uuid, quantity numeric)
    left join public.batches b on b.id = x."batchId" and b.company_id = p_company_id
    left join public.products p on p.id = x."productId" and p.company_id = p_company_id and p.id = b.product_id
    where p.id is null or b.id is null or nullif(btrim(p.external_id), '') is null
      or nullif(btrim(b.external_id), '') is null or x.quantity is null or x.quantity <= 0
      or x.quantity <> round(x.quantity, 2)
  ) then
    raise exception 'El contenido no tiene cantidades o identidades ERP válidas para la empresa.' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('productExternalId', product_ext,
    'lotExternalId', lot_ext, 'quantity', quantity, 'uom', uom)
    order by product_ext, lot_ext) into result
  from (
    select btrim(p.external_id) product_ext, btrim(b.external_id) lot_ext,
      sum(x.quantity) quantity,
      coalesce(nullif(btrim(p.external_uom), ''), public.erp_outbox_default_uom(p.unit_of_measure)) uom
    from jsonb_to_recordset(p_snapshot) x("productId" uuid, "batchId" uuid, quantity numeric)
    join public.batches b on b.id = x."batchId" and b.company_id = p_company_id
    join public.products p on p.id = x."productId" and p.company_id = p_company_id and p.id = b.product_id
    group by btrim(p.external_id), btrim(b.external_id),
      coalesce(nullif(btrim(p.external_uom), ''), public.erp_outbox_default_uom(p.unit_of_measure))
  ) items;
  return result;
end;
$$;
revoke all on function public.erp_pallet_items_v2(uuid, jsonb) from public, anon, authenticated, service_role;

create function public.erp_outbox_dispatch_payload_v2(p_order_id uuid, p_operator_id uuid, p_dispatched_at timestamptz)
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
      or op.dispatch_items is distinct from op.expected_items)) then
    raise exception 'Hay contenido sin validar en la orden.' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderLineExternalId', (select min(ol.external_id) from public.dispatch_order_lines ol
      join public.products pr on pr.id = ol.product_id and pr.company_id = o.company_id
      where ol.order_id = o.id and btrim(pr.external_id) = item->>'productExternalId' having count(*) = 1),
    'palletCode', p.qr_code, 'productExternalId', item->>'productExternalId',
    'lotExternalId', item->>'lotExternalId', 'quantity', item->'quantity', 'uom', item->>'uom')
    order by p.qr_code, item->>'productExternalId', item->>'lotExternalId'), '[]'::jsonb) into lines
  from public.order_pallets op join public.pallets p on p.id = op.pallet_id and p.company_id = o.company_id
  cross join lateral jsonb_array_elements(public.erp_pallet_items_v2(o.company_id, op.dispatch_items)) item
  where op.order_id = o.id and op.expected;
  if jsonb_array_length(lines) = 0 then raise exception 'La orden no tiene ítems para despachar.' using errcode = '22023'; end if;
  return jsonb_build_object('contractVersion', 2, 'idempotencyKey', 'dispatch:' || btrim(o.external_id),
    'orderExternalId', btrim(o.external_id),
    'dispatchedAt', to_char(p_dispatched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operator', jsonb_build_object('id', p_operator_id, 'name', operator_name), 'lines', lines);
end;
$$;
revoke all on function public.erp_outbox_dispatch_payload_v2(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

-- p_snapshot se pasa explícitamente desde la relación de la orden para soportar
-- DELETE y para no depender del orden de los triggers de validación.
create function public.erp_pallet_scan_event_v2(p_order_id uuid, p_pallet_id uuid,
  p_action text, p_at timestamptz, p_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.dispatch_orders; pallet_code text; prefix text; scan_key text; event_key text;
  scan_payload jsonb; items jsonb; round_number bigint;
begin
  if p_action not in ('scan', 'unscan') or p_action is null then
    raise exception 'Acción de escaneo inválida.' using errcode = '22023';
  end if;
  -- Serializa las rondas de la orden y permite repetir el mismo número de orden
  -- en otra empresa sin mezclar las claves o los ítems.
  select * into o from public.dispatch_orders where id = p_order_id for update;
  if not found or o.external_id is null then return; end if;
  select qr_code into pallet_code from public.pallets where id = p_pallet_id and company_id = o.company_id;
  if not found then raise exception 'El pallet no pertenece a la empresa.' using errcode = '42501'; end if;
  prefix := 'pallet-scan:' || btrim(o.external_id) || ':' || pallet_code || ':';
  select coalesce(max(substring(e.idempotency_key from length(prefix) + 1)::bigint), 0)
    into round_number from public.erp_outbox_events e
    where e.company_id = o.company_id and e.event_type = 'pallet_scanned'
      and starts_with(e.idempotency_key, prefix)
      and substring(e.idempotency_key from length(prefix) + 1) ~ '^[0-9]+$';
  if p_action = 'scan' then
    items := public.erp_pallet_items_v2(o.company_id, p_snapshot);
    scan_key := prefix || (round_number + 1);
    event_key := scan_key;
  else
    if round_number = 0 then return; end if;
    scan_key := prefix || round_number;
    select payload into scan_payload from public.erp_outbox_events
      where company_id = o.company_id and idempotency_key = scan_key and event_type = 'pallet_scanned';
    -- Unscan fiel al original, incluso si es un evento v1 o cambió el catálogo.
    if scan_payload->>'contractVersion' = '1' then
      items := jsonb_build_array(jsonb_build_object('productExternalId', scan_payload->'productExternalId',
        'lotExternalId', scan_payload->'lotExternalId', 'quantity', scan_payload->'quantity', 'uom', scan_payload->'uom'));
    else items := scan_payload->'items'; end if;
    if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) = 0 then
      raise exception 'El scan original no tiene contenido reversible.' using errcode = '22023';
    end if;
    event_key := 'pallet-unscan:' || btrim(o.external_id) || ':' || pallet_code || ':' || round_number;
  end if;
  insert into public.erp_outbox_events(company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
  values (o.company_id, case when p_action = 'scan' then 'pallet_scanned' else 'pallet_unscanned' end,
    gen_random_uuid(), event_key, jsonb_build_object('contractVersion', 2, 'idempotencyKey', event_key,
      'action', p_action, 'scanIdempotencyKey', scan_key, 'orderExternalId', btrim(o.external_id),
      'palletCode', pallet_code, 'items', items,
      'at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), auth.uid())
  on conflict (company_id, idempotency_key) do nothing;
end;
$$;
revoke all on function public.erp_pallet_scan_event_v2(uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
