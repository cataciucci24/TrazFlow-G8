-- Persona 3, ola 0. Un ítem por pallet; no cambia el modelo de escritura.
-- item_id es opaco: en TRZ-111 identificará la fila de pallet_items.
-- security_invoker evita que el dueño de la vista eluda las policies de RLS.
create view public.pallet_contents with (security_invoker = true) as
select
  pallet.id as item_id,
  pallet.id as pallet_id,
  pallet.company_id,
  batch.id as batch_id,
  batch.batch_number,
  batch.expiration_date,
  product.id as product_id,
  product.name as product_name,
  product.sku as product_sku,
  product.unit_of_measure,
  pallet.quantity,
  batch.source_system as lot_source_system
from public.pallets pallet
join public.batches batch on batch.id = pallet.batch_id
join public.products product on product.id = batch.product_id
  and product.company_id = pallet.company_id;

revoke all on public.pallet_contents from public, anon, authenticated;
grant select on public.pallet_contents to authenticated, service_role;

comment on view public.pallet_contents is
  'Lectura canónica de contenido de pallets. Una fila por ítem; hoy un ítem por pallet. App: src/lib/pallets/contents.ts. Conserva RLS.';

notify pgrst, 'reload schema';

-- Las RPC conservan sus guardas de rol/asignación y su proyección pública.
-- TRZ-106: proyección mínima para los tres lectores de QR. No amplía las
-- policies de users/locations ni devuelve emails o el JSON de auditoría.
create or replace function public.get_pallet_scan_details(p_qr_code text)
returns table (
  qr_code text, product_name text, product_sku text, batch_number text,
  quantity numeric, unit_of_measure text, physical_location text,
  last_event_type text, last_event_at timestamptz, actor_name text, actor_role text
)
language sql stable security definer set search_path = '' as $$
  select p.qr_code, content.product_name, content.product_sku, content.batch_number,
    content.quantity, content.unit_of_measure::text,
    case when location.id is not null then location.warehouse_code || ' / ' || location.code
      else p.current_location end,
    event.event_type::text, event.created_at, actor.name, actor.role::text
  from public.users caller
  join public.pallets p on p.company_id = caller.company_id
  join public.pallet_contents content on content.pallet_id = p.id and content.company_id = caller.company_id
  left join public.warehouse_locations location
    on location.id = p.current_location_id and location.company_id = caller.company_id
  left join lateral (
    select e.event_type, e.created_at, e.user_id
    from public.traceability_events e
    where e.pallet_id = p.id and e.company_id = caller.company_id
    order by e.created_at desc, e.id desc limit 1
  ) event on true
  left join public.users actor on actor.id = event.user_id and actor.company_id = caller.company_id
  where caller.id = auth.uid() and caller.revoked_at is null
    and length(btrim(p_qr_code)) between 1 and 512
    and p.qr_code = btrim(p_qr_code)
    and (
      caller.role in ('warehouse_operator', 'logistics_manager')
      or (caller.role = 'driver_operator' and exists (
        select 1 from public.order_pallets op
        join public.dispatch_orders orders on orders.id = op.order_id
        where op.pallet_id = p.id and orders.company_id = caller.company_id
          and orders.driver_id = caller.id
      ))
    );
$$;
revoke all on function public.get_pallet_scan_details(text) from public, anon;
grant execute on function public.get_pallet_scan_details(text) to authenticated;

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
  select pallet.id, pallet.qr_code, content.product_name, content.product_sku,
    content.batch_number, content.quantity, content.unit_of_measure::text,
    relation.delivery_outcome, relation.delivered_at
  from public.order_pallets relation
  join public.pallets pallet on pallet.id = relation.pallet_id
  join public.pallet_contents content on content.pallet_id = pallet.id and content.company_id = pallet.company_id
  where relation.order_id = p_order_id and relation.expected = true
  order by pallet.qr_code;
end;
$$;
revoke all on function public.get_order_delivery_pallets(uuid) from public, anon, service_role;
grant execute on function public.get_order_delivery_pallets(uuid) to authenticated;


create or replace function public.get_lot_traceability(p_batch_number text)
returns table (
  batch_id uuid,
  batch_number text,
  expiration_date date,
  batch_quantity integer,
  product_id uuid,
  product_name text,
  product_sku text,
  product_unit_of_measure text,
  pallet_id uuid,
  pallet_qr_code text,
  pallet_status pallet_status,
  pallet_current_location text,
  pallet_quantity numeric,
  movement_id uuid,
  movement_order_id uuid,
  movement_origin_location text,
  movement_destination_location text,
  movement_resulting_status pallet_status,
  movement_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth_role() is distinct from 'logistics_manager' then
    return;
  end if;

  if p_batch_number is null
     or btrim(p_batch_number) = ''
     or length(btrim(p_batch_number)) > 512 then
    return;
  end if;

  return query
  select
    batch.id,
    batch.batch_number,
    batch.expiration_date,
    batch.quantity,
    product.id,
    product.name,
    product.sku,
    product.unit_of_measure,
    pallet.id,
    pallet.qr_code,
    pallet.status,
    pallet.current_location,
    content.quantity,
    movement.id,
    movement.order_id,
    movement.origin_location,
    movement.destination_location,
    movement.resulting_status,
    movement.created_at
  from batches batch
  join products product on product.id = batch.product_id
  left join public.pallet_contents content on content.batch_id = batch.id and content.company_id = product.company_id
  left join pallets pallet on pallet.id = content.pallet_id
  left join movements movement on movement.pallet_id = pallet.id
  where batch.batch_number = btrim(p_batch_number)
    and product.company_id = auth_company_id()
  order by pallet.qr_code, movement.created_at, movement.id;
end;
$$;

revoke all on function public.get_lot_traceability(text) from public, anon;
grant execute on function public.get_lot_traceability(text) to authenticated;
