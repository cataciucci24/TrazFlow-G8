-- TRZ-24: logística registra un reingreso completo. Reenviar requiere una orden nueva.
create function public.return_pallet_to_warehouse(p_qr_code text, p_reason text)
returns table (outcome text, pallet_id uuid, qr_code text)
language plpgsql security definer set search_path = '' as $$
declare caller public.users; p public.pallets; item record; source_order uuid;
begin
  select * into caller from public.users where id = auth.uid() and revoked_at is null;
  if not found or caller.role <> 'logistics_manager' then
    return query select 'forbidden', null::uuid, null::text; return;
  end if;
  if p_qr_code is null or length(btrim(p_qr_code)) not between 1 and 512
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    return query select 'invalid_input', null::uuid, null::text; return;
  end if;
  select * into p from public.pallets pallet where pallet.qr_code = btrim(p_qr_code)
    and pallet.company_id = caller.company_id for update;
  if not found then return query select 'pallet_not_found', null::uuid, null::text; return; end if;
  -- Un reintento no genera otro movimiento ni evento.
  if p.status = 'in_warehouse' then return query select 'already_in_warehouse', p.id, p.qr_code; return; end if;
  if p.status not in ('delivered', 'delivery_discrepancy', 'received') then
    return query select 'invalid_status', p.id, p.qr_code; return;
  end if;
  if not exists (select 1 from public.warehouses w where w.company_id = caller.company_id
    and w.code = p.warehouse_code and w.active) then
    return query select 'warehouse_inactive', p.id, p.qr_code; return;
  end if;
  -- No introduce stock ERP que aún no figure en el saldo. Reingresar no modifica ese saldo.
  for item in select * from public.pallet_items i where i.pallet_id = p.id order by i.batch_id loop
    perform public.assert_pallet_item_stock(caller.company_id, p.id, item.batch_id, p.warehouse_code, item.quantity);
  end loop;
  select op.order_id into source_order from public.order_pallets op
    join public.dispatch_orders o on o.id = op.order_id
    where op.pallet_id = p.id and o.confirmed_at is not null order by o.confirmed_at desc limit 1;
  update public.pallets set status = 'in_warehouse', current_location = 'Depósito', current_location_id = null where id = p.id;
  insert into public.movements(pallet_id, order_id, origin_location, destination_location, resulting_status, user_id)
    values (p.id, source_order, p.current_location, 'Depósito', 'in_warehouse', caller.id);
  insert into public.traceability_events(company_id, pallet_id, order_id, event_type, user_id, details)
    values (caller.company_id, p.id, source_order, 'pallet_returned', caller.id,
      jsonb_build_object('reason', btrim(p_reason), 'previous_status', p.status,
        'warehouse_code', p.warehouse_code, 'items', public.pallet_content_snapshot(p.id)));
  return query select 'returned', p.id, p.qr_code;
end;
$$;
revoke all on function public.return_pallet_to_warehouse(text, text) from public, anon, service_role;
grant execute on function public.return_pallet_to_warehouse(text, text) to authenticated;
