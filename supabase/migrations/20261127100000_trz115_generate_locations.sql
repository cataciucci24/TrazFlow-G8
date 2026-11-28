-- Generate all requested locations in one transaction. Known duplicates are
-- counted; unexpected failures roll back the whole operation.
create or replace function public.generate_warehouse_locations(p_warehouse_code text, p_expected_layout jsonb, p_items jsonb)
returns table(created integer, skipped integer, rejected integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.auth_company_id();
  v_warehouse public.warehouses%rowtype;
  v_item jsonb;
  v_key text;
  v_index integer;
  v_constraint text;
  v_created integer := 0;
  v_skipped integer := 0;
  v_rejected integer := 0;
  v_columns text[] := array['aisle', 'rack', 'level', 'position'];
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede generar ubicaciones.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'La lista de ubicaciones no es válida.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 2000 then
    raise exception 'Generá entre 1 y 2000 ubicaciones.' using errcode = '22023';
  end if;
  select * into v_warehouse from public.warehouses
    where company_id = v_company and code = p_warehouse_code for update;
  if not found then raise exception 'El depósito no existe.' using errcode = 'P0002'; end if;
  if not v_warehouse.active then raise exception 'El depósito está inactivo.' using errcode = 'TF112'; end if;
  if v_warehouse.layout is distinct from p_expected_layout then
    raise exception 'La distribución cambió. Actualizá la vista previa.' using errcode = '40001';
  end if;
  -- Validate the entire request before inserting any row.
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'code') is distinct from 'string'
       or (v_item->>'code') !~ '^[A-Z0-9][A-Z0-9_-]{0,39}$' then
      raise exception 'Código de ubicación inválido.' using errcode = '22023';
    end if;
    for v_index in 1..4 loop
      v_key := v_columns[v_index];
      if v_index <= jsonb_array_length(v_warehouse.layout) then
        if jsonb_typeof(v_item->v_key) is distinct from 'string' or length(btrim(v_item->>v_key)) not between 1 and 40 then
          raise exception 'Coordenadas incompletas o inválidas.' using errcode = '22023';
        end if;
      elsif v_item->v_key is not null and v_item->v_key <> 'null'::jsonb then
        raise exception 'Hay coordenadas que no corresponden al depósito.' using errcode = '22023';
      end if;
    end loop;
  end loop;
  -- Shared codes may contend across warehouses: acquire unique-index entries
  -- in the same order to avoid inversions between concurrent batches.
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'code' loop
    if exists (select 1 from public.warehouse_locations l where l.company_id = v_company
      and l.warehouse_code = p_warehouse_code and l.aisle = v_item->>'aisle'
      and l.rack is not distinct from v_item->>'rack'
      and l.level is not distinct from v_item->>'level'
      and l.position is not distinct from v_item->>'position') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      insert into public.warehouse_locations(company_id, warehouse_code, code, aisle, rack, level, position)
      values (v_company, p_warehouse_code, v_item->>'code', v_item->>'aisle', v_item->>'rack', v_item->>'level', v_item->>'position');
      v_created := v_created + 1;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'warehouse_locations_coordinates_key' then v_skipped := v_skipped + 1;
      elsif v_constraint = 'warehouse_locations_company_id_code_key' then v_rejected := v_rejected + 1;
      else raise;
      end if;
    end;
  end loop;
  return query select v_created, v_skipped, v_rejected;
end;
$$;
revoke all on function public.generate_warehouse_locations(text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.generate_warehouse_locations(text,jsonb,jsonb) to authenticated;
