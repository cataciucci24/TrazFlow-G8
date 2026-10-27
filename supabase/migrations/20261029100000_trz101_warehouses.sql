-- TRZ-101 (1/2): depósitos de TrazFlow en una tabla, en lugar del código fijo 'DEP-01'.
--
-- Hasta acá cada empresa tenía un solo depósito, 'DEP-01', escrito como texto con check en warehouse_locations
-- (TRZ-96) y erp_warehouse_mappings (US-ERP-03), y sin check en erp_stock_balances y pallets.warehouse_code
-- (TRZ-100). Desde esta migración:
--
--   * warehouses guarda los depósitos de cada empresa, identificados por (company_id, code);
--   * las cuatro tablas apuntan a warehouses con una FK compuesta (company_id, warehouse_code);
--   * las empresas que ya existen reciben su 'DEP-01' (ahí están sus ubicaciones y pallets);
--   * las empresas nuevas NO reciben un depósito automático: sin ERP se cargan en el onboarding
--     (docs/runbook-trz-101.md); con ERP los trae la sincronización (20261029100100);
--   * al crear una ubicación o un pallet sin indicar depósito, se usa el único depósito activo de la empresa
--     (así, con un solo depósito, la app y la API se comportan como antes).
--
-- Los UUID de ubicaciones, sus QR (TRZLOC:<uuid>), el historial y los pallets en 'DEP-01' no cambian.

/* ---------- Tabla ---------- */

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  -- Código de TrazFlow: el que usan ubicaciones, pallets y saldos. No cambia nunca.
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name text not null check (length(btrim(name)) between 1 and 140),
  -- Id del depósito en el ERP (en ERPNext, el `name` del Warehouse). Null = depósito cargado en TrazFlow.
  external_id text check (external_id is null or length(btrim(external_id)) between 1 and 300),
  source_system text not null default 'trazflow' check (source_system in ('trazflow', 'erp')),
  -- false = el ERP lo deshabilitó o dejó de informarlo. No se borra.
  active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouses_company_code_key unique (company_id, code),
  constraint warehouses_external_id_source_check check ((source_system = 'trazflow') = (external_id is null))
);
create unique index warehouses_company_external_id_key on public.warehouses(company_id, external_id)
  where external_id is not null;
create trigger trg_warehouses_updated_at before update on public.warehouses
  for each row execute function public.set_updated_at();

-- Lectura para logística y depósito de la empresa. Nadie escribe por la API: los depósitos del ERP los escribe
-- erp_sync_apply_warehouses y los de una empresa sin ERP se cargan en el onboarding.
alter table public.warehouses enable row level security;
revoke all on public.warehouses from anon, authenticated, service_role;
grant select on public.warehouses to authenticated, service_role;
create policy warehouses_select on public.warehouses for select to authenticated
  using (
    company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
  );

/* ---------- Backfill: DEP-01 para las empresas que ya existen ---------- */

insert into public.warehouses (company_id, code, name)
select id, 'DEP-01', 'Depósito principal' from public.companies;

-- Vínculo creado por un error de tipeo en la nube (TRZ-101, comentario del 19/10): el ERP no tiene ese depósito,
-- nunca trajo saldos. Se borra solo si sigue sin saldos.
delete from public.erp_warehouse_mappings mapping
where mapping.external_warehouse_id = 'Deposito central - erv'
  and not exists (
    select 1 from public.erp_stock_balances stock
    where stock.company_id = mapping.company_id and stock.external_warehouse_id = mapping.external_warehouse_id
  );

/* ---------- FKs en lugar de los check ---------- */

alter table public.warehouse_locations
  drop constraint warehouse_locations_warehouse_code_check,
  alter column warehouse_code drop default,
  add constraint warehouse_locations_warehouse_fkey
    foreign key (company_id, warehouse_code) references public.warehouses(company_id, code) on delete restrict;

alter table public.erp_warehouse_mappings
  drop constraint erp_warehouse_mappings_warehouse_code_check,
  alter column warehouse_code drop default,
  add constraint erp_warehouse_mappings_warehouse_fkey
    foreign key (company_id, warehouse_code) references public.warehouses(company_id, code) on delete restrict;

alter table public.erp_stock_balances
  add constraint erp_stock_balances_warehouse_fkey
    foreign key (company_id, warehouse_code) references public.warehouses(company_id, code) on delete restrict;

alter table public.pallets
  alter column warehouse_code drop default,
  add constraint pallets_warehouse_fkey
    foreign key (company_id, warehouse_code) references public.warehouses(company_id, code) on delete restrict;

-- Los vínculos del ERP ya no se cargan a mano (texto libre, TRZ-101): los crea la sincronización al importar
-- los depósitos. Logística los sigue leyendo.
revoke insert, delete on public.erp_warehouse_mappings from authenticated;
drop policy erp_warehouse_mappings_insert on public.erp_warehouse_mappings;
drop policy erp_warehouse_mappings_delete on public.erp_warehouse_mappings;

/* ---------- Depósito al crear una ubicación o un pallet ---------- */

-- Sin warehouse_code, usa el único depósito activo de la empresa. Con warehouse_code, exige que exista en la
-- empresa (lo mismo que la FK, pero antes del tope por saldo, para que el error sea claro) y que esté activo.
-- Errores:
--   TF110 la empresa no tiene depósitos
--   TF111 la empresa tiene varios depósitos y no se indicó cuál
--   TF112 el depósito está inactivo
--   23503 el depósito no existe en la empresa
create function public.default_warehouse_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_codes text[];
  v_active boolean;
begin
  if new.warehouse_code is null then
    select coalesce(array_agg(code order by code), '{}') into v_codes
    from public.warehouses where company_id = new.company_id and active;
    if cardinality(v_codes) = 0 then
      raise exception 'Tu empresa no tiene depósitos configurados.' using errcode = 'TF110';
    elsif cardinality(v_codes) > 1 then
      raise exception 'Tu empresa tiene varios depósitos: elegí en cuál.' using errcode = 'TF111';
    end if;
    new.warehouse_code := v_codes[1];
    return new;
  end if;

  select active into v_active from public.warehouses
  where company_id = new.company_id and code = new.warehouse_code;
  if not found then
    raise exception 'El depósito % no existe en tu empresa.', new.warehouse_code using errcode = '23503';
  elsif not v_active then
    raise exception 'El depósito % está inactivo.', new.warehouse_code using errcode = 'TF112';
  end if;
  return new;
end;
$$;
revoke all on function public.default_warehouse_code() from public, anon, authenticated, service_role;

-- El nombre empieza con "trg_<tabla>_default" para que corra antes que trg_pallets_erp_stock_cap y
-- trg_pallets_guard_erp (los triggers del mismo evento corren por orden alfabético): el tope necesita el depósito.
create trigger trg_pallets_default_warehouse before insert on public.pallets
  for each row execute function public.default_warehouse_code();
create trigger trg_warehouse_locations_default_warehouse before insert on public.warehouse_locations
  for each row execute function public.default_warehouse_code();

-- La app ahora puede elegir el depósito al crear (con varios depósitos). No se puede cambiar después: mover un
-- pallet o una ubicación de depósito es una transferencia, fuera de alcance.
grant insert (warehouse_code) on public.pallets to authenticated;
grant insert (warehouse_code) on public.warehouse_locations to authenticated;

/* ---------- Ubicar un pallet: la ubicación tiene que ser de su depósito ---------- */

-- Igual que en 20261016130100, con un chequeo más antes de escribir: sin él, la FK
-- pallets_location_warehouse_fkey igual lo rechaza, pero con un error técnico.
create or replace function public.assign_pallet_location(
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
  if target.warehouse_code is distinct from destination.warehouse_code then
    raise exception 'La ubicacion es del deposito % y el pallet esta en %. Mover pallets entre depositos no esta disponible.',
      destination.warehouse_code, target.warehouse_code using errcode = 'TF113';
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
