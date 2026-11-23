-- SOLO PARA DESARROLLO LOCAL (TRZ-71). Vehículo del chofer de prueba que crea supabase/seed.sql.
--
-- No se carga solo: supabase/config.toml corre únicamente ./seed.sql. Después de `npx supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seeds/trz71_driver_vehicles.sql
--
-- Idempotente: si el chofer ya tiene vehículo, lo deja como está. 6 pallets alcanza para ver la alerta con las
-- órdenes del mock ERP asignadas al chofer en un mismo día.

insert into public.driver_vehicles (company_id, driver_id, name, capacity_pallets)
select users.company_id, users.id, 'Camión AB 123 CD', 6
from public.users
where users.id = '5eed0000-0000-0000-0000-000000000103' and users.role = 'driver_operator'
on conflict (driver_id) do nothing;
