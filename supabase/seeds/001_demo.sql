-- SOLO PARA DESARROLLO LOCAL. Nunca ejecutar contra la nube (staging ni producción).
--
-- `npx supabase db reset` lo corre sobre la base LOCAL recién migrada ([db.seed] en supabase/config.toml).
-- Las contraseñas son de prueba y públicas (están en el README): no reutilizarlas en ningún otro lado.
--
-- Crea una empresa de prueba y un usuario por rol, listos para iniciar sesión:
--   logistica@trazflow.test  logistics_manager
--   deposito@trazflow.test   warehouse_operator
--   chofer@trazflow.test     driver_operator
-- Contraseña de los tres: test1234
--
-- No carga datos del ERP: productos, lotes, pallets y órdenes los genera la sincronización con ERP_PROVIDER=mock.
--
-- Depósitos (TRZ-101): las empresas nuevas no reciben uno automático, así que el seed hace el onboarding y carga
-- DEP-01, igual que la nube. También deja DEP-01 vinculado a "Depósito Central - SRV", como está en la nube: con
-- ERP_PROVIDER=mock, la primera sincronización deja a Central como DEP-01 y trae Norte como DEPOSITO-NORTE. Sin ERP,
-- el vínculo no se usa y la empresa trabaja con DEP-01 como siempre.
--
-- Cada usuario necesita tres filas: auth.users (credenciales), auth.identities (proveedor email, sin la cual
-- GoTrue no deja iniciar sesión) y public.users (perfil: empresa y rol, que leen auth_company_id() y auth_role()).

do $$
begin
  -- Red de seguridad: el seed solo corre sobre una base vacía. Si alguien lo ejecuta a mano contra una base con
  -- datos (por ejemplo la de la nube), aborta antes de escribir nada.
  if exists (select 1 from auth.users) or exists (select 1 from public.companies) then
    raise exception 'supabase/seed.sql es solo para una base LOCAL vacía (npx supabase db reset); esta base ya tiene datos.';
  end if;
end;
$$;

insert into public.companies (id, name, tax_id) values
  ('5eed0000-0000-0000-0000-000000000001', 'TrazFlow Demo', '30-00000000-0');

with seed_users (id, email, name, role) as (
  values
    ('5eed0000-0000-0000-0000-000000000101'::uuid, 'logistica@trazflow.test', 'Logística Demo', 'logistics_manager'::public.user_role),
    ('5eed0000-0000-0000-0000-000000000102'::uuid, 'deposito@trazflow.test', 'Depósito Demo', 'warehouse_operator'::public.user_role),
    ('5eed0000-0000-0000-0000-000000000103'::uuid, 'chofer@trazflow.test', 'Chofer Demo', 'driver_operator'::public.user_role)
),
new_auth_users as (
  -- Los campos de token van como '' y no NULL: GoTrue falla al leer NULL en ellos.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('test1234', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('name', name), now(), now(),
    '', '', '', '', '', '', '', ''
  from seed_users
  returning id
),
new_identities as (
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
  from seed_users
)
insert into public.users (id, company_id, name, email, role)
select s.id, '5eed0000-0000-0000-0000-000000000001', s.name, s.email, s.role
from seed_users s
join new_auth_users a on a.id = s.id;

-- Onboarding de depósitos (TRZ-101).
insert into public.warehouses (company_id, code, name) values
  ('5eed0000-0000-0000-0000-000000000001', 'DEP-01', 'Depósito principal');
insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values
  ('5eed0000-0000-0000-0000-000000000001', 'Depósito Central - SRV', 'DEP-01', '5eed0000-0000-0000-0000-000000000101');
