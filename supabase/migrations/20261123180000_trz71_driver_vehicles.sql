-- ============================================================================
-- TRZ-71: vehículo de cada chofer y su capacidad en pallets
-- ============================================================================
-- Planificación de viajes: logística carga el vehículo de cada chofer con cuántos pallets entran, y TrazFlow
-- avisa cuando las órdenes asignadas a un chofer para un día no entran (src/lib/trip-planning/suggest.ts).
-- Un vehículo por chofer: la planificación compara las órdenes del chofer contra una sola capacidad.

create table public.driver_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  driver_id uuid not null references public.users(id) on delete cascade,
  -- Nombre o patente, como lo reconoce logística.
  name text not null check (char_length(btrim(name)) between 1 and 60),
  capacity_pallets integer not null check (capacity_pallets > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_vehicles_driver_key unique (driver_id)
);

create index idx_driver_vehicles_company on public.driver_vehicles(company_id);

-- El chofer tiene que ser un driver_operator de la misma empresa. Se valida con un trigger (y no en la policy)
-- porque las policies de users no dejan ver a todos los usuarios desde cualquier rol.
create or replace function public.driver_vehicles_check_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users
    where id = new.driver_id and company_id = new.company_id and role = 'driver_operator' and revoked_at is null
  ) then
    raise exception 'El vehículo tiene que ser de un chofer activo de la empresa.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.driver_vehicles_check_driver() from public, anon, authenticated;

create trigger driver_vehicles_check_driver
  before insert or update on public.driver_vehicles
  for each row execute function public.driver_vehicles_check_driver();

-- Logística de la empresa lee y escribe; el chofer solo lee su vehículo.
alter table public.driver_vehicles enable row level security;
revoke all on public.driver_vehicles from anon, authenticated, service_role;
grant select, insert, update, delete on public.driver_vehicles to authenticated;

create policy driver_vehicles_select on public.driver_vehicles for select to authenticated
  using (
    ((select public.auth_role()) = 'logistics_manager' and company_id = (select public.auth_company_id()))
    or ((select public.auth_role()) = 'driver_operator' and driver_id = (select auth.uid()))
  );

create policy driver_vehicles_insert on public.driver_vehicles for insert to authenticated
  with check ((select public.auth_role()) = 'logistics_manager' and company_id = (select public.auth_company_id()));

create policy driver_vehicles_update on public.driver_vehicles for update to authenticated
  using ((select public.auth_role()) = 'logistics_manager' and company_id = (select public.auth_company_id()))
  with check ((select public.auth_role()) = 'logistics_manager' and company_id = (select public.auth_company_id()));

create policy driver_vehicles_delete on public.driver_vehicles for delete to authenticated
  using ((select public.auth_role()) = 'logistics_manager' and company_id = (select public.auth_company_id()));
