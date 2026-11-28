-- Reuse the layout trigger's warehouse row lock to serialize individual
-- location creation with warehouse deactivation.
create or replace function public.validate_location_layout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  levels integer;
  warehouse_active boolean;
begin
  select pg_catalog.jsonb_array_length(w.layout), w.active
    into levels, warehouse_active
    from public.warehouses w
    where w.company_id = new.company_id and w.code = new.warehouse_code
    for update;
  if not found then
    raise exception 'El depósito no existe.' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' and not warehouse_active then
    raise exception 'El depósito está inactivo.' using errcode = 'TF112';
  end if;
  if (new.rack is not null) <> (levels >= 2)
     or (new.level is not null) <> (levels >= 3)
     or (new.position is not null) <> (levels >= 4) then
    raise exception 'Las coordenadas deben coincidir con los niveles del depósito.' using errcode = '23514';
  end if;
  return new;
end;
$$;
