-- TRZ-115: preserve the four existing coordinate columns and all location IDs.
alter table public.warehouses add column layout jsonb not null default
  '[{"label":"Pasillo"},{"label":"Estantería"},{"label":"Nivel"},{"label":"Posición"}]'::jsonb;

create function public.valid_warehouse_layout(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when pg_catalog.jsonb_typeof(value) = 'array' then
    pg_catalog.jsonb_array_length(value) between 1 and 4
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(value) element
      where pg_catalog.jsonb_typeof(element) is distinct from 'object'
        or pg_catalog.jsonb_typeof(element->'label') is distinct from 'string'
        or pg_catalog.length(pg_catalog.btrim(element->>'label')) = 0
    )
  else false end;
$$;
alter table public.warehouses add constraint warehouses_layout_check
  check (public.valid_warehouse_layout(layout));

alter table public.warehouse_locations
  alter column rack drop not null,
  alter column level drop not null,
  alter column position drop not null,
  drop constraint warehouse_locations_company_id_warehouse_code_aisle_rack_le_key,
  add constraint warehouse_locations_coordinates_key unique nulls not distinct
    (company_id, warehouse_code, aisle, rack, level, position);

-- Lock the parent row on insertion so layout changes and location creation
-- serialize, including when the caller cannot update warehouses directly.
create function public.validate_location_layout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare levels integer;
begin
  select pg_catalog.jsonb_array_length(w.layout) into levels
  from public.warehouses w
  where w.company_id = new.company_id and w.code = new.warehouse_code
  for update;
  if not found then
    raise exception 'El depósito no existe.' using errcode = '23503';
  end if;
  if (new.rack is not null) <> (levels >= 2)
     or (new.level is not null) <> (levels >= 3)
     or (new.position is not null) <> (levels >= 4) then
    raise exception 'Las coordenadas deben coincidir con los niveles del depósito.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_warehouse_locations_layout before insert or update of company_id, warehouse_code, aisle, rack, level, position
  on public.warehouse_locations for each row execute function public.validate_location_layout();
revoke all on function public.validate_location_layout() from public, anon, authenticated;

create function public.guard_warehouse_layout_levels()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.valid_warehouse_layout(new.layout) then
    raise exception 'El formato de distribución del depósito no es válido.' using errcode = '23514';
  end if;
  if pg_catalog.jsonb_array_length(old.layout) is distinct from pg_catalog.jsonb_array_length(new.layout)
     and exists (select 1 from public.warehouse_locations l
                 where l.company_id = old.company_id and l.warehouse_code = old.code) then
    raise exception 'No se puede cambiar la cantidad de niveles de un depósito con ubicaciones.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_warehouses_layout_levels before update of layout on public.warehouses
  for each row execute function public.guard_warehouse_layout_levels();
revoke all on function public.guard_warehouse_layout_levels() from public, anon, authenticated;

-- Limit the new API capability to this column and company logistics managers.
grant update (layout) on public.warehouses to authenticated;
create policy warehouses_layout_update on public.warehouses for update to authenticated
  using (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager')
  with check (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager');
