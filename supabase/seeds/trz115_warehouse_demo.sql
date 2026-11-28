-- SOLO PARA DESARROLLO LOCAL. No ejecutar en staging ni producción.
-- [db.seed] ejecuta este archivo junto con los demás seeds después de migrar.
-- Empresa separada: no altera la empresa ni los usuarios del seed 001_demo.sql.
-- Cuentas locales: logistica.trz115@trazflow.test y deposito.trz115@trazflow.test
-- Contraseña de prueba para ambas: test1234 (la misma convención del seed local).

begin;

do $$
begin
  if exists (select 1 from public.companies where id = '5eed1150-0000-0000-0000-000000000001')
     or exists (select 1 from auth.users where id in ('5eed1150-0000-0000-0000-000000000101', '5eed1150-0000-0000-0000-000000000102')
                or email in ('logistica.trz115@trazflow.test', 'deposito.trz115@trazflow.test')) then
    raise exception 'Los datos de demostración de TRZ-115 ya existen; no se sobrescriben.';
  end if;
end;
$$;

insert into public.companies(id, name) values
  ('5eed1150-0000-0000-0000-000000000001', 'Demo distribuciones TRZ-115');

with seed_users(id, email, name, role) as (
  values
    ('5eed1150-0000-0000-0000-000000000101'::uuid, 'logistica.trz115@trazflow.test', 'Logística TRZ-115', 'logistics_manager'::public.user_role),
    ('5eed1150-0000-0000-0000-000000000102'::uuid, 'deposito.trz115@trazflow.test', 'Depósito TRZ-115', 'warehouse_operator'::public.user_role)
), new_auth_users as (
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('test1234', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', name), now(), now(),
    '', '', '', '', '', '', '', '' from seed_users returning id
), new_identities as (
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
  from seed_users
)
insert into public.users(id, company_id, name, email, role)
select s.id, '5eed1150-0000-0000-0000-000000000001', s.name, s.email, s.role
from seed_users s join new_auth_users a on a.id = s.id;

insert into public.warehouses(company_id, code, name, layout) values
  ('5eed1150-0000-0000-0000-000000000001', 'EST-01', 'Depósito con estanterías',
   '[{"label":"Pasillo"},{"label":"Estantería"},{"label":"Nivel"},{"label":"Posición"}]'),
  ('5eed1150-0000-0000-0000-000000000001', 'PISO-01', 'Depósito de piso',
   '[{"label":"Sector"},{"label":"Hilera"},{"label":"Posición"}]');

insert into public.warehouse_locations(id, company_id, warehouse_code, code, aisle, rack, level, position) values
  ('5eed1150-0000-0000-0000-000000000201', '5eed1150-0000-0000-0000-000000000001', 'EST-01', 'EST-A-01-01-01', 'A', '01', '01', '01'),
  ('5eed1150-0000-0000-0000-000000000202', '5eed1150-0000-0000-0000-000000000001', 'PISO-01', 'PISO-B-02-03', 'B', '02', '03', null);

insert into public.products(id, company_id, sku, name, unit_of_measure) values
  ('5eed1150-0000-0000-0000-000000000301', '5eed1150-0000-0000-0000-000000000001', 'DEMO-115', 'Producto demo TRZ-115', 'unidades');
insert into public.batches(id, product_id, batch_number, quantity) values
  ('5eed1150-0000-0000-0000-000000000401', '5eed1150-0000-0000-0000-000000000301', 'LOTE-115', 0);
insert into public.pallets(id, company_id, batch_id, quantity, current_location, warehouse_code) values
  ('5eed1150-0000-0000-0000-000000000501', '5eed1150-0000-0000-0000-000000000001', '5eed1150-0000-0000-0000-000000000401', 10, 'Depósito', 'EST-01'),
  ('5eed1150-0000-0000-0000-000000000502', '5eed1150-0000-0000-0000-000000000001', '5eed1150-0000-0000-0000-000000000401', 10, 'Depósito', 'PISO-01');

-- La RPC autentica al operador y registra movimiento y evento de trazabilidad.
select set_config('request.jwt.claim.sub', '5eed1150-0000-0000-0000-000000000102', true);
set local role authenticated;
select public.assign_pallet_location('5eed1150-0000-0000-0000-000000000501', '5eed1150-0000-0000-0000-000000000201', null);
select public.assign_pallet_location('5eed1150-0000-0000-0000-000000000502', '5eed1150-0000-0000-0000-000000000202', null);

commit;
