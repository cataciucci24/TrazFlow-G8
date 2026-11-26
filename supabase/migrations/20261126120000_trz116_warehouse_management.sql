-- Serialize new stock and returns against manual warehouse deactivation.
-- ERP synchronization retains its existing behavior.
create function public.lock_pallet_warehouse_for_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_active boolean;
begin
  if new.status in ('in_warehouse', 'assigned') and
     (tg_op = 'INSERT' or old.status not in ('in_warehouse', 'assigned')) then
    select w.active into v_active from public.warehouses w
      where w.company_id = new.company_id and w.code = new.warehouse_code for update;
    if not found then
      raise exception 'El depósito no existe.' using errcode = '23503';
    elsif not v_active then
      raise exception 'El depósito está inactivo.' using errcode = 'TF112';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.lock_pallet_warehouse_for_stock() from public, anon, authenticated;
-- Alphabetical order: default warehouse, this lock, then ERP stock validation.
create trigger trg_pallets_deposit_stock_lock before insert or update of status on public.pallets
  for each row execute function public.lock_pallet_warehouse_for_stock();

-- All writes are scoped and authorized in the database, without general table grants.
create function public.manage_manual_warehouse(p_action text, p_code text, p_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid := public.auth_company_id(); v_warehouse public.warehouses%rowtype;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede administrar depósitos.' using errcode = '42501';
  end if;
  if p_code is null or p_code !~ '^[A-Z0-9][A-Z0-9_-]{0,39}$' then
    raise exception 'Código de depósito inválido.' using errcode = '22023';
  end if;
  if p_action in ('create', 'rename') and (p_name is null or pg_catalog.length(pg_catalog.btrim(p_name)) not between 1 and 140) then
    raise exception 'Nombre de depósito inválido.' using errcode = '22023';
  end if;
  if p_action = 'create' then
    insert into public.warehouses(company_id, code, name) values (v_company, p_code, pg_catalog.btrim(p_name));
    return;
  end if;
  if p_action not in ('rename', 'deactivate') or p_action is null then
    raise exception 'Operación inválida.' using errcode = '22023';
  end if;
  select * into v_warehouse from public.warehouses where company_id = v_company and code = p_code for update;
  if not found then raise exception 'Depósito inexistente.' using errcode = 'P0002'; end if;
  if v_warehouse.source_system <> 'trazflow' then
    raise exception 'El depósito está administrado por el ERP.' using errcode = '42501';
  end if;
  if p_action = 'rename' then
    update public.warehouses set name = pg_catalog.btrim(p_name) where id = v_warehouse.id;
  else
    if exists (select 1 from public.pallets p where p.company_id = v_company and p.warehouse_code = p_code
               and p.status in ('in_warehouse', 'assigned')) then
      raise exception 'El depósito contiene pallets en stock.' using errcode = '23514';
    end if;
    update public.warehouses set active = false where id = v_warehouse.id;
  end if;
end;
$$;
revoke all on function public.manage_manual_warehouse(text, text, text) from public, anon, service_role;
grant execute on function public.manage_manual_warehouse(text, text, text) to authenticated;

-- TRZ-24: lock pallet, then warehouse, then ERP balances. Preserve outcomes.
create or replace function public.return_pallet_to_warehouse(p_qr_code text, p_reason text)
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
  perform 1 from public.warehouses w where w.company_id = caller.company_id
    and w.code = p.warehouse_code and w.active for update;
  if not found then
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
