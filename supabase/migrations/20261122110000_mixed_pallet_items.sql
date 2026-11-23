-- TRZ-111: contenido normalizado, con puente para altas/ediciones monolote existentes.
create table public.pallet_items (
  id uuid primary key default gen_random_uuid(),
  pallet_id uuid not null references public.pallets(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete restrict,
  quantity numeric check (quantity > 0 and quantity = round(quantity, 2)),
  unique (pallet_id, batch_id)
);
create index pallet_items_batch on public.pallet_items(batch_id, pallet_id);
alter table public.pallet_items enable row level security;
revoke all on public.pallet_items from public, anon, authenticated;
grant select on public.pallet_items to authenticated;
create policy pallet_items_select on public.pallet_items for select to authenticated
  using (exists (select 1 from public.pallets p where p.id = pallet_id));

-- Las cantidades NULL históricas se conservan; las altas nuevas exigen cantidad.
insert into public.pallet_items(id, pallet_id, batch_id, quantity)
select id, id, batch_id, quantity from public.pallets;

create or replace view public.pallet_contents with (security_invoker = true) as
select item.id as item_id, pallet.id as pallet_id, pallet.company_id,
  batch.id as batch_id, batch.batch_number, batch.expiration_date,
  product.id as product_id, product.name as product_name, product.sku as product_sku,
  product.unit_of_measure, item.quantity, batch.source_system as lot_source_system
from public.pallet_items item
join public.pallets pallet on pallet.id = item.pallet_id
join public.batches batch on batch.id = item.batch_id
join public.products product on product.id = batch.product_id and product.company_id = pallet.company_id;

-- batch_id/quantity de la cabecera quedan como puente del primer ítem, nunca como total.
-- No se concede escritura directa de ítems: las altas pasan por la RPC atómica.
create function public.mirror_single_pallet_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.batch_id is not distinct from old.batch_id and new.quantity is not distinct from old.quantity then return new; end if;
    if (select count(*) from public.pallet_items i where i.pallet_id = new.id) > 1 then
      raise exception 'Un pallet mixto no se edita con el formulario de un solo ítem.' using errcode = '23514';
    end if;
    update public.pallet_items set batch_id = new.batch_id, quantity = new.quantity where pallet_id = new.id;
  else
    insert into public.pallet_items(pallet_id, batch_id, quantity) values (new.id, new.batch_id, new.quantity);
  end if;
  return new;
end;
$$;
revoke all on function public.mirror_single_pallet_content() from public, anon, authenticated, service_role;
create trigger trg_pallet_content_bridge after insert or update of batch_id, quantity on public.pallets
  for each row execute function public.mirror_single_pallet_content();

create function public.check_pallet_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.pallets; b public.batches; product public.products;
begin
  select * into p from public.pallets where id = new.pallet_id;
  select * into b from public.batches where id = new.batch_id;
  select * into product from public.products where id = b.product_id;
  if product.company_id is distinct from p.company_id then
    raise exception 'El lote no pertenece a la empresa del pallet.' using errcode = '23514';
  end if;
  if new.quantity is not null and public.erp_sync_quantity_problem(new.quantity, product.unit_of_measure, false) is not null then
    raise exception 'Cantidad inválida para la unidad del producto.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_pallet_item() from public, anon, authenticated, service_role;
create trigger trg_check_pallet_item before insert or update on public.pallet_items
  for each row execute function public.check_pallet_item();

-- Snapshot estable de producto/lote/cantidad; se conserva por orden aunque luego el pallet reingrese.
create function public.pallet_content_snapshot(p_pallet_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('productId', c.product_id, 'batchId', c.batch_id,
    'quantity', c.quantity) order by c.batch_id), '[]'::jsonb)
  from public.pallet_contents c where c.pallet_id = p_pallet_id;
$$;
revoke all on function public.pallet_content_snapshot(uuid) from public, anon, authenticated, service_role;
alter table public.order_pallets add column expected_items jsonb,
  add column dispatch_items jsonb, add column reception_items jsonb;
update public.order_pallets op set expected_items = public.pallet_content_snapshot(op.pallet_id);
alter table public.order_pallets alter column expected_items set not null;

create function public.snapshot_order_pallet_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.expected_items := public.pallet_content_snapshot(new.pallet_id);
  new.dispatch_items := null;
  new.reception_items := null;
  return new;
end;
$$;
revoke all on function public.snapshot_order_pallet_content() from public, anon, authenticated, service_role;
create trigger trg_snapshot_order_pallet before insert on public.order_pallets
  for each row execute function public.snapshot_order_pallet_content();

create function public.refresh_draft_pallet_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.order_pallets op set expected_items = public.pallet_content_snapshot(new.pallet_id),
    dispatch_items = null, detected_at_dispatch = false, validated_at = null, validated_by = null
  from public.dispatch_orders o where o.id = op.order_id and o.status = 'draft' and op.pallet_id = new.pallet_id;
  return new;
end;
$$;
revoke all on function public.refresh_draft_pallet_content() from public, anon, authenticated, service_role;
create trigger trg_refresh_draft_pallet_content after insert or update on public.pallet_items
  for each row execute function public.refresh_draft_pallet_content();

-- Las credenciales/contrato/outbox son propiedad de las personas 2 y 5.
-- Hasta integrar la ola 2, ninguna operación ERP puede publicar un mixto truncado al primer ítem.
create function public.guard_mixed_erp_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.dispatch_orders o where o.id = new.order_id and o.external_id is not null)
    and (select count(*) from public.pallet_items i where i.pallet_id = new.pallet_id) > 1 then
    raise exception 'Los pallets mixtos en órdenes ERP requieren la integración de la ola 2 (TRZ-111).' using errcode = 'TM111';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_mixed_erp_order() from public, anon, authenticated, service_role;
create trigger trg_guard_mixed_erp_order before insert on public.order_pallets
  for each row execute function public.guard_mixed_erp_order();

create or replace function public.erp_pallet_stock_usage(p_company_id uuid, p_batch_id uuid default null, p_warehouse_code text default null)
returns table (
  pallet_id uuid,
  batch_id uuid,
  warehouse_code text,
  quantity numeric,
  phase text,
  counts boolean,
  event_id uuid,
  erp_reference text
)
language sql stable security definer set search_path = '' as $$
  with classified as (
    select
      pallet.id,
      item.batch_id,
      pallet.warehouse_code,
      coalesce(item.quantity, 0) as quantity,
      event.id as event_id,
      event.erp_reference,
      case
        when pallet.status in ('in_warehouse', 'assigned') then 'in_warehouse'
        when dispatch.order_id is null then 'departed_without_dispatch'
        when dispatch.external_id is null then 'manual_order'
        when event.id is null then 'untracked_dispatch'
        when event.status <> 'sent' then 'report_pending'
        when event.erp_document_status = 'not_tracked' then 'not_tracked'
        when event.erp_document_status is null or event.erp_document_status = 'draft' then 'document_pending'
        when event.erp_document_status in ('cancelled', 'not_found') then 'document_problem'
        when balance.oldest_synced_at > event.erp_document_confirmed_seen_at then 'released'
        else 'confirmed_unsynced'
      end as phase
    from public.pallets pallet
    join public.pallet_items item on item.pallet_id = pallet.id
    join public.batches batch on batch.id = item.batch_id and batch.source_system = 'erp'
    left join lateral (
      select orders.id as order_id, orders.external_id
      from public.order_pallets relation
      join public.dispatch_orders orders on orders.id = relation.order_id
      where relation.pallet_id = pallet.id and relation.expected = true and orders.confirmed_at is not null
      order by orders.confirmed_at desc
      limit 1
    ) dispatch on pallet.status not in ('in_warehouse', 'assigned')
    left join public.erp_outbox_events event
      on event.event_type = 'dispatch_confirmed' and event.aggregate_id = dispatch.order_id
      and event.company_id = pallet.company_id
    left join lateral (
      select min(stock.synced_at) as oldest_synced_at
      from public.erp_stock_balances stock
      join public.erp_warehouse_mappings mapping
        on mapping.company_id = stock.company_id and mapping.external_warehouse_id = stock.external_warehouse_id
        and mapping.warehouse_code = stock.warehouse_code
      where stock.company_id = pallet.company_id and stock.batch_id = item.batch_id
        and stock.warehouse_code = pallet.warehouse_code
    ) balance on event.erp_document_status = 'confirmed'
    where pallet.company_id = p_company_id
      and (p_batch_id is null or item.batch_id = p_batch_id)
      and (p_warehouse_code is null or pallet.warehouse_code = p_warehouse_code)
  )
  select id, batch_id, warehouse_code, quantity, phase,
         phase in ('in_warehouse', 'report_pending', 'document_pending', 'confirmed_unsynced',
                   'document_problem', 'departed_without_dispatch'),
         event_id, erp_reference
  from classified;
$$;
revoke all on function public.erp_pallet_stock_usage(uuid, uuid, text) from public, anon, authenticated, service_role;


create function public.assert_pallet_item_stock(p_company_id uuid, p_pallet_id uuid, p_batch_id uuid, p_warehouse_code text, p_quantity numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.batches;
  v_product public.products;
  v_balance numeric;
  v_rows integer;
  v_used numeric;
  v_available numeric;
begin
  select * into v_lot from public.batches where id = p_batch_id;
  if not found or v_lot.source_system <> 'erp' then
    return;
  end if;
  select * into v_product from public.products where id = v_lot.product_id;
  if v_lot.external_active is false or v_product.external_active is false then
    raise exception 'El lote % o su producto está inactivo en el ERP: no se pueden armar pallets.', v_lot.batch_number
      using errcode = 'TF102';
  end if;

  select coalesce(sum(locked.quantity), 0), count(*) into v_balance, v_rows
  from (
    select stock.quantity
    from public.erp_stock_balances stock
    join public.erp_warehouse_mappings mapping
      on mapping.company_id = stock.company_id and mapping.external_warehouse_id = stock.external_warehouse_id
      and mapping.warehouse_code = stock.warehouse_code
    where stock.company_id = p_company_id and stock.batch_id = p_batch_id
      and stock.warehouse_code = p_warehouse_code
    order by stock.external_warehouse_id
    for update of stock
  ) locked;
  if v_rows = 0 then
    raise exception 'Ese lote no tiene saldo en el ERP para este depósito.' using errcode = 'TF101';
  end if;

  select coalesce(sum(usage.quantity), 0) into v_used
  from public.erp_pallet_stock_usage(p_company_id, p_batch_id, p_warehouse_code) usage
  where usage.counts and usage.pallet_id <> p_pallet_id;

  v_available := v_balance - v_used;
  if coalesce(p_quantity, 0) > v_available then
    raise exception 'La cantidad supera el saldo del ERP: disponible % % del lote % en %.',
        greatest(v_available, 0), v_product.unit_of_measure, v_lot.batch_number, p_warehouse_code
      using errcode = 'TF100',
            detail = jsonb_build_object(
              'available', v_available,
              'unit', v_product.unit_of_measure,
              'lot', v_lot.batch_number,
              'warehouseCode', p_warehouse_code)::text;
  end if;
  return;
end;
$$;
revoke all on function public.assert_pallet_item_stock(uuid, uuid, uuid, text, numeric) from public, anon, authenticated, service_role;


create function public.check_pallet_item_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.pallets;
begin
  if tg_op = 'UPDATE' and new.batch_id = old.batch_id and new.quantity <= old.quantity then return new; end if;
  select * into p from public.pallets where id = new.pallet_id;
  perform public.assert_pallet_item_stock(p.company_id, p.id, new.batch_id, p.warehouse_code, new.quantity);
  return new;
end;
$$;
revoke all on function public.check_pallet_item_stock() from public, anon, authenticated, service_role;
create trigger trg_pallet_item_stock before insert or update on public.pallet_items
  for each row execute function public.check_pallet_item_stock();

create function public.create_pallet_with_items(p_items jsonb, p_warehouse_code text default null)
returns table (pallet_id uuid, qr_code text)
language plpgsql security definer set search_path = '' as $$
declare caller public.users; target public.pallets; entry record; item_count integer;
begin
  select * into caller from public.users where id = auth.uid() and revoked_at is null;
  if not found or caller.role not in ('logistics_manager', 'warehouse_operator') then
    raise exception 'No tenés permisos para armar pallets.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Contenido inválido.' using errcode = '22023'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 100 then raise exception 'Ingresá entre 1 y 100 ítems.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
    or jsonb_typeof(x->'quantity') is distinct from 'number'
    or jsonb_typeof(x->'batch_id') is distinct from 'string') then
    raise exception 'Cada ítem requiere lote y cantidad numérica.' using errcode = '22023';
  end if;
  if (select count(distinct x.batch_id) from jsonb_to_recordset(p_items) x(batch_id uuid, quantity numeric)) <> item_count then
    raise exception 'No repitas un lote: sumá su cantidad en un solo ítem.' using errcode = '22023';
  end if;
  -- Orden global de lotes/saldos para evitar interbloqueos entre dos armados mixtos.
  for entry in select x.batch_id, x.quantity, product.unit_of_measure, batch.company_id
    from jsonb_to_recordset(p_items) x(batch_id uuid, quantity numeric)
    left join public.batches batch on batch.id = x.batch_id
    left join public.products product on product.id = batch.product_id order by x.batch_id
  loop
    if entry.company_id is distinct from caller.company_id or entry.quantity is null
      or public.erp_sync_quantity_problem(entry.quantity, entry.unit_of_measure, false) is not null then
      raise exception 'Revisá el lote y la cantidad de cada ítem.' using errcode = '22023';
    end if;
  end loop;
  for entry in select x.* from jsonb_to_recordset(p_items) x(batch_id uuid, quantity numeric) order by x.batch_id
  loop
    if target.id is null then
      insert into public.pallets(company_id, batch_id, quantity, warehouse_code, current_location)
      values (caller.company_id, entry.batch_id, entry.quantity,
        nullif(btrim(p_warehouse_code), ''), 'Depósito')
      returning * into target;
    else
      insert into public.pallet_items(pallet_id, batch_id, quantity) values (target.id, entry.batch_id, entry.quantity);
    end if;
  end loop;
  return query select target.id, target.qr_code;
end;
$$;
revoke all on function public.create_pallet_with_items(jsonb, text) from public, anon, service_role;
grant execute on function public.create_pallet_with_items(jsonb, text) to authenticated;
notify pgrst, 'reload schema';
