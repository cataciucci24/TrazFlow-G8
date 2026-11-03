-- TRZ-62 y TRZ-63: movimientos de stock y escaneos de despacho informados al ERP por el mismo outbox (TRZ-94).
--
-- Tres eventos nuevos. El procesador (src/lib/erp-outbox/processor.ts) elige la operación por el prefijo de la clave:
--   * stock_entry_requested  stock-entry:{id}                       → reportStockEntry
--     Alta (recepción) o baja (ajuste) que logística o depósito le piden al ERP desde "Stock según ERP".
--     En ERPNext queda un Stock Entry en borrador: lo confirma el ERP, TrazFlow no mueve stock.
--     Armar un pallet o corregir su cantidad NO es un alta: el pallet sale del saldo del ERP (TRZ-100) y
--     se informa en el despacho. Informarlo acá duplicaría el stock.
--   * pallet_scanned         pallet-scan:{orden}:{pallet}:{n}       → reportPalletScan (agrega la línea)
--   * pallet_unscanned       pallet-unscan:{orden}:{pallet}:{n}     → reportPalletScan (saca la línea)
--     Lo encola un trigger sobre order_pallets: validated_at se llena al escanear y se borra (o se borra la
--     fila) al desasociar el pallet o corregir su cantidad. n cuenta los escaneos del pallet en la orden, así
--     escanear, sacar y volver a escanear da claves distintas. Solo órdenes del ERP y lotes del ERP.
--
-- Los eventos que no son despacho quedan not_tracked al enviarse (trigger de 20261028130000).

alter table public.erp_outbox_events drop constraint erp_outbox_events_event_type_check;
alter table public.erp_outbox_events add constraint erp_outbox_events_event_type_check
  check (event_type in (
    'dispatch_confirmed', 'delivery_confirmed', 'delivery_receipt_attached',
    'stock_entry_requested', 'pallet_scanned', 'pallet_unscanned'
  ));

/* ---------- TRZ-62: alta o baja de stock en el ERP ---------- */

--   requested | forbidden | invalid_input | lot_not_found | warehouse_not_mapped
create function public.request_erp_stock_entry(
  p_batch_id uuid,
  p_warehouse_code text,
  p_entry_type text,
  p_quantity numeric,
  p_reason text
)
returns table (outcome text, event_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
  v_lot record;
  v_warehouse text;
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  if auth.uid() is null or public.auth_role() is null
     or public.auth_role() not in ('logistics_manager', 'warehouse_operator') then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if p_entry_type is null or p_entry_type not in ('receipt', 'issue')
     or p_quantity is null or p_quantity <= 0
     or length(btrim(coalesce(p_reason, ''))) not between 1 and 200
     or length(btrim(coalesce(p_warehouse_code, ''))) = 0 then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select batch.external_id as lot_ext, product.external_id as product_ext,
         coalesce(product.external_uom, public.erp_outbox_default_uom(product.unit_of_measure)) as uom
    into v_lot
  from public.batches batch
  join public.products product on product.id = batch.product_id
  where batch.id = p_batch_id and batch.company_id = v_company and batch.source_system = 'erp'
    and batch.external_id is not null and product.external_id is not null;
  if not found then
    return query select 'lot_not_found'::text, null::uuid;
    return;
  end if;

  -- Depósito del ERP: el que tiene saldo de ese lote en ese depósito de TrazFlow; si no, el primero vinculado.
  select stock.external_warehouse_id into v_warehouse
  from public.erp_stock_balances stock
  join public.erp_warehouse_mappings mapping
    on mapping.company_id = stock.company_id and mapping.external_warehouse_id = stock.external_warehouse_id
    and mapping.warehouse_code = stock.warehouse_code
  where stock.company_id = v_company and stock.batch_id = p_batch_id and stock.warehouse_code = btrim(p_warehouse_code)
  order by stock.quantity desc, stock.external_warehouse_id
  limit 1;
  if v_warehouse is null then
    select mapping.external_warehouse_id into v_warehouse
    from public.erp_warehouse_mappings mapping
    where mapping.company_id = v_company and mapping.warehouse_code = btrim(p_warehouse_code)
    order by mapping.external_warehouse_id
    limit 1;
  end if;
  if v_warehouse is null then
    return query select 'warehouse_not_mapped'::text, null::uuid;
    return;
  end if;

  v_key := 'stock-entry:' || v_id::text;
  insert into public.erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
  values (
    v_id, v_company, 'stock_entry_requested', v_id, v_key,
    jsonb_build_object(
      'contractVersion', 1,
      'idempotencyKey', v_key,
      'entryType', p_entry_type,
      'productExternalId', v_lot.product_ext,
      'lotExternalId', v_lot.lot_ext,
      'warehouseExternalId', v_warehouse,
      'quantity', p_quantity,
      'uom', v_lot.uom,
      'reason', btrim(p_reason),
      'requestedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'requestedBy', jsonb_build_object('id', auth.uid(), 'name', (select u.name from public.users u where u.id = auth.uid()))
    ),
    auth.uid()
  );
  return query select 'requested'::text, v_id;
end;
$$;
revoke all on function public.request_erp_stock_entry(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.request_erp_stock_entry(uuid, text, text, numeric, text) to authenticated;

/* ---------- TRZ-63: escaneos de despacho ---------- */

create function public.erp_pallet_scan_event(p_order_id uuid, p_pallet_id uuid, p_action text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
  v_line record;
  v_prefix text;
  v_count integer;
  v_scan_key text;
  v_key text;
begin
  select orders.company_id, btrim(orders.external_id) as external_id into v_order
  from public.dispatch_orders orders
  where orders.id = p_order_id and orders.external_id is not null;
  if not found then return; end if; -- orden manual (o borrándose): no hay a quién informar

  select pallet.qr_code, pallet.quantity, product.external_id as product_ext, batch.external_id as lot_ext,
         coalesce(product.external_uom, public.erp_outbox_default_uom(product.unit_of_measure)) as uom
    into v_line
  from public.pallets pallet
  join public.batches batch on batch.id = pallet.batch_id
  join public.products product on product.id = batch.product_id
  where pallet.id = p_pallet_id;
  if not found or v_line.product_ext is null or v_line.lot_ext is null then return; end if;

  v_prefix := 'pallet-scan:' || v_order.external_id || ':' || v_line.qr_code || ':';
  select count(*) into v_count
  from public.erp_outbox_events event
  where event.company_id = v_order.company_id and event.event_type = 'pallet_scanned'
    and starts_with(event.idempotency_key, v_prefix);

  if p_action = 'scan' then
    v_scan_key := v_prefix || (v_count + 1);
    v_key := v_scan_key;
  else
    if v_count = 0 then return; end if; -- se escaneó antes de esta migración: no hay línea que sacar
    v_scan_key := v_prefix || v_count;
    v_key := 'pallet-unscan:' || v_order.external_id || ':' || v_line.qr_code || ':' || v_count;
  end if;

  insert into public.erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
  values (
    v_order.company_id,
    case when p_action = 'scan' then 'pallet_scanned' else 'pallet_unscanned' end,
    gen_random_uuid(),
    v_key,
    jsonb_build_object(
      'contractVersion', 1,
      'idempotencyKey', v_key,
      'action', p_action,
      'scanIdempotencyKey', v_scan_key,
      'orderExternalId', v_order.external_id,
      'palletCode', v_line.qr_code,
      'productExternalId', v_line.product_ext,
      'lotExternalId', v_line.lot_ext,
      'quantity', v_line.quantity,
      'uom', v_line.uom,
      'at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    auth.uid()
  )
  on conflict do nothing;
end;
$$;
revoke all on function public.erp_pallet_scan_event(uuid, uuid, text, timestamptz) from public, anon, authenticated;

create function public.enqueue_erp_pallet_scan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.validated_at is not null then
      perform public.erp_pallet_scan_event(old.order_id, old.pallet_id, 'unscan', now());
    end if;
  elsif old.validated_at is null and new.validated_at is not null then
    perform public.erp_pallet_scan_event(new.order_id, new.pallet_id, 'scan', new.validated_at);
  elsif old.validated_at is not null and new.validated_at is null then
    perform public.erp_pallet_scan_event(new.order_id, new.pallet_id, 'unscan', now());
  end if;
  return null;
end;
$$;
revoke all on function public.enqueue_erp_pallet_scan() from public, anon, authenticated;

create trigger trg_order_pallets_erp_scan after update of validated_at or delete on public.order_pallets
  for each row execute function public.enqueue_erp_pallet_scan();
