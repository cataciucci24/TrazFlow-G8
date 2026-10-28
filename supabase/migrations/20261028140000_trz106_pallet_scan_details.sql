-- TRZ-106: proyección mínima para los tres lectores de QR. No amplía las
-- policies de users/locations ni devuelve emails o el JSON de auditoría.
create function public.get_pallet_scan_details(p_qr_code text)
returns table (
  qr_code text, product_name text, product_sku text, batch_number text,
  quantity numeric, unit_of_measure text, physical_location text,
  last_event_type text, last_event_at timestamptz, actor_name text, actor_role text
)
language sql stable security definer set search_path = '' as $$
  select p.qr_code, product.name, product.sku, batch.batch_number,
    p.quantity, product.unit_of_measure::text,
    case when location.id is not null then location.warehouse_code || ' / ' || location.code
      else p.current_location end,
    event.event_type::text, event.created_at, actor.name, actor.role::text
  from public.users caller
  join public.pallets p on p.company_id = caller.company_id
  join public.batches batch on batch.id = p.batch_id
  join public.products product on product.id = batch.product_id and product.company_id = caller.company_id
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
