-- TRZ-96: one warehouse per company for this sprint. Reuse movements and
-- traceability_events; no parallel pallet_location_events audit table.
create table public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  warehouse_code text not null default 'DEP-01' check (warehouse_code = 'DEP-01'),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  aisle text not null check (length(btrim(aisle)) between 1 and 40),
  rack text not null check (length(btrim(rack)) between 1 and 40),
  level text not null check (length(btrim(level)) between 1 and 40),
  position text not null check (length(btrim(position)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, warehouse_code, aisle, rack, level, position),
  unique (company_id, id)
);
alter table public.pallets add column current_location_id uuid;
alter table public.pallets add constraint pallets_company_location_fkey
  foreign key (company_id, current_location_id)
  references public.warehouse_locations(company_id, id) on delete restrict;
create index idx_pallets_current_location on public.pallets(current_location_id)
  where current_location_id is not null;
alter table public.warehouse_locations enable row level security;
revoke all on public.warehouse_locations from anon, authenticated;
grant select on public.warehouse_locations to authenticated;
grant insert (company_id, code, aisle, rack, level, position)
  on public.warehouse_locations to authenticated;
create policy locations_select on public.warehouse_locations for select to authenticated
  using (company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('warehouse_operator', 'logistics_manager'));
create policy locations_insert on public.warehouse_locations for insert to authenticated
  with check (company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('warehouse_operator', 'logistics_manager'));
-- Codes and coordinates are stable: no UPDATE/DELETE API privileges.
-- Preserve existing product/quantity edits and order association, but location
-- changes must go through the RPC. Table-level UPDATE would override column grants.
revoke update on public.pallets from authenticated;
revoke update (current_location, current_location_id) on public.pallets from authenticated;
grant update (batch_id, quantity, status) on public.pallets to authenticated;

-- Direct updates are still needed by order reservation and its compensation
-- (in_warehouse <-> assigned). Transitions involving shipment/delivery must
-- use the existing authorized SECURITY DEFINER RPCs. Keep this trigger
-- SECURITY INVOKER: current_user distinguishes API writes from those RPCs;
-- auth.uid()/auth.role() would still identify the caller inside a definer RPC.
create function public.guard_direct_pallet_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.status is distinct from old.status
    and (old.status not in ('in_warehouse', 'assigned')
      or new.status not in ('in_warehouse', 'assigned')) then
    raise exception 'Los estados de despacho y entrega solo pueden cambiarse mediante las operaciones autorizadas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_guard_direct_pallet_status before update of status
  on public.pallets for each row execute function public.guard_direct_pallet_status();
revoke all on function public.guard_direct_pallet_status() from public, anon, authenticated;

-- Existing dispatch/delivery RPCs keep their behavior. Leaving the warehouse
-- clears the physical slot without rewriting any historical events.
create function public.clear_departed_pallet_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status not in ('in_warehouse', 'assigned') then
    new.current_location_id := null;
  end if;
  return new;
end;
$$;
create trigger trg_clear_departed_pallet_location before update of status
  on public.pallets for each row execute function public.clear_departed_pallet_location();
revoke all on function public.clear_departed_pallet_location() from public, anon, authenticated;

create function public.assign_pallet_location(
  p_pallet_id uuid, p_location_id uuid, p_expected_location_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  caller_company uuid := public.auth_company_id();
  target public.pallets%rowtype;
  destination public.warehouse_locations%rowtype;
  kind public.event_type;
  actor_name text;
begin
  if auth.uid() is null or caller_company is null
     or public.auth_role() is distinct from 'warehouse_operator' then
    raise exception 'Solo un operador de deposito activo puede registrar movimientos.' using errcode = '42501';
  end if;
  select * into target from public.pallets
    where id = p_pallet_id and company_id = caller_company for update;
  if not found then
    raise exception 'El pallet no existe o no pertenece a tu empresa.' using errcode = 'P0002';
  end if;
  select * into destination from public.warehouse_locations
    where id = p_location_id and company_id = caller_company;
  if not found then
    raise exception 'La ubicacion no existe o no pertenece a tu empresa.' using errcode = 'P0002';
  end if;
  if target.status not in ('in_warehouse', 'assigned') then
    raise exception 'El pallet ya no esta en deposito; no puede recibir una ubicacion fisica.' using errcode = '23514';
  end if;
  if target.current_location_id is distinct from p_expected_location_id then
    raise exception 'La ubicacion cambio mientras operabas. Actualiza la pantalla e intenta nuevamente.' using errcode = '40001';
  end if;
  if target.current_location_id = destination.id then
    raise exception 'El pallet ya esta en esa ubicacion.' using errcode = '23514';
  end if;
  kind := case when target.current_location_id is null
    then 'location_assigned'::public.event_type else 'location_changed'::public.event_type end;
  select name into actor_name from public.users where id = auth.uid();
  update public.pallets set current_location_id = destination.id,
    current_location = destination.warehouse_code || ' / ' || destination.code
    where id = target.id;
  insert into public.movements (pallet_id, origin_location, destination_location, resulting_status, user_id)
    values (target.id, target.current_location, destination.warehouse_code || ' / ' || destination.code, target.status, auth.uid());
  insert into public.traceability_events (company_id, pallet_id, event_type, user_id, details)
    values (caller_company, target.id, kind, auth.uid(), jsonb_build_object(
      'previous_location_id', target.current_location_id, 'new_location_id', destination.id,
      'previous_location', target.current_location, 'new_location', destination.warehouse_code || ' / ' || destination.code,
      'location_code', destination.code, 'warehouse_code', destination.warehouse_code,
      'user_name', actor_name));
end;
$$;
revoke all on function public.assign_pallet_location(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_pallet_location(uuid, uuid, uuid) to authenticated;
-- Prevent clients from forging these audit events outside the atomic RPC.
create function public.guard_location_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.event_type in ('location_assigned', 'location_changed')
    and current_user in ('authenticated', 'anon') then
    raise exception 'Los eventos de ubicacion se registran mediante assign_pallet_location.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_guard_location_event before insert on public.traceability_events
  for each row execute function public.guard_location_event();
revoke all on function public.guard_location_event() from public, anon, authenticated;
