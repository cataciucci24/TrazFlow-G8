-- TRZ-112 (parte 2): alta de empresa desde la app.
-- Solo base LOCAL migrada. Ejecutar con npm run test:sql (o psql -v ON_ERROR_STOP=1 -f este_archivo).
-- Dos empresas: A (cargada como hoy, con su responsable) y X (creada con create_company_with_manager).
-- Todos los fixtures se revierten.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'TRZ-112 alta: %', message; end if;
end; $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('41120000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.login(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case when n is null then '' else pg_temp.uid(n)::text end, true);
$$;
create function pg_temp.expect_create_failure(company_name text, tax_id text, plan_code text, expected_code text)
returns void language plpgsql as $$
begin
  begin
    perform public.create_company_with_manager(company_name, tax_id, plan_code);
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise exception 'TRZ-112 alta: se esperaba % y llegó % (%)', expected_code, sqlstate, sqlerrm;
  end;
  raise exception 'TRZ-112 alta: el alta debió fallar con %', expected_code;
end; $$;

/* ---------- Permisos ---------- */

select pg_temp.assert_true(has_function_privilege('authenticated', 'public.create_company_with_manager(text, text, text)', 'EXECUTE'), 'authenticated puede dar de alta');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.create_company_with_manager(text, text, text)', 'EXECUTE'), 'anon no puede dar de alta');
select pg_temp.assert_true(not has_function_privilege('service_role', 'public.create_company_with_manager(text, text, text)', 'EXECUTE'), 'service_role no la usa');
select pg_temp.assert_true(has_function_privilege('authenticated', 'public.get_signup_plans()', 'EXECUTE'), 'authenticated lee planes del alta');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.get_signup_plans()', 'EXECUTE'), 'anon no lee planes del alta');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.is_valid_cuit(text)', 'EXECUTE'), 'is_valid_cuit es interna');

/* ---------- Validación de CUIT ---------- */

select pg_temp.assert_true(public.is_valid_cuit('30712345671'), 'CUIT válido de sociedad');
select pg_temp.assert_true(public.is_valid_cuit('20123456786'), 'CUIT válido de persona');
select pg_temp.assert_true(public.is_valid_cuit('27111111117'), 'CUIT válido con prefijo 27');
select pg_temp.assert_true(not public.is_valid_cuit('30712345678'), 'dígito verificador incorrecto');
select pg_temp.assert_true(not public.is_valid_cuit('30000000040'), 'resto 10 nunca es válido');
select pg_temp.assert_true(not public.is_valid_cuit('99712345671'), 'prefijo inexistente');
select pg_temp.assert_true(not public.is_valid_cuit('3071234567'), '10 dígitos');
select pg_temp.assert_true(not public.is_valid_cuit(null), 'null');

/* ---------- Fixtures ---------- */

-- Empresa A, como se cargan hoy: con su responsable logístico (uid 1) y un CUIT con guiones.
insert into public.companies (id, name, tax_id) values ('41120000-0000-0000-0001-000000000001', 'TRZ112 A', '30-50001091-2');
insert into public.warehouses (company_id, code, name) values ('41120000-0000-0000-0001-000000000001', 'DEP-01', 'Depósito A');

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select pg_temp.uid(n), 'trz112-' || n || '@test.local', now(), jsonb_build_object('name', '  Persona ' || n || '  ')
from generate_series(1, 12) n;
update auth.users set email_confirmed_at = null where id = pg_temp.uid(3);             -- sin confirmar
update auth.users set raw_user_meta_data = '{"name":"   "}' where id = pg_temp.uid(4);  -- sin nombre válido

insert into public.users (id, company_id, name, email, role) values
  (pg_temp.uid(1), '41120000-0000-0000-0001-000000000001', 'Responsable A', 'trz112-1@test.local', 'logistics_manager'),
  (pg_temp.uid(5), '41120000-0000-0000-0001-000000000001', 'Operador A', 'trz112-5@test.local', 'warehouse_operator');
insert into public.products (company_id, sku, name, unit_of_measure)
  values ('41120000-0000-0000-0001-000000000001', 'TRZ112-A', 'Producto de A', 'unidades');

insert into public.access_requests (user_id, company_id, requested_role, status) values
  (pg_temp.uid(6), '41120000-0000-0000-0001-000000000001', 'warehouse_operator', 'pending'),
  (pg_temp.uid(7), '41120000-0000-0000-0001-000000000001', 'driver_operator', 'rejected');

-- Atomicidad: un trigger temporal hace fallar el último paso del alta (el depósito) para un CUIT puntual.
create function pg_temp.fail_warehouse() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.companies c where c.id = new.company_id and c.tax_id = '33-69345023-9') then
    raise exception 'falla simulada' using errcode = 'P0999';
  end if;
  return new;
end; $$;
create trigger trz112_fail_warehouse before insert on public.warehouses
  for each row execute function pg_temp.fail_warehouse();

set local role authenticated;

/* ---------- Planes elegibles ---------- */

select pg_temp.login(2);
select pg_temp.assert_true((select array_agg(code order by code) from public.get_signup_plans()) = array['growth', 'starter'],
  'el alta ofrece solo Starter y Growth');
select pg_temp.login(1);
select pg_temp.assert_true(not exists (select 1 from public.get_signup_plans()), 'quien ya tiene perfil no ve planes del alta');
select pg_temp.login(null);
select pg_temp.assert_true(not exists (select 1 from public.get_signup_plans()), 'sin sesión no hay planes');

/* ---------- Rechazos ---------- */

select pg_temp.login(null);
select pg_temp.expect_create_failure('Sin sesión SA', '30-71234567-1', 'starter', '42501');

select pg_temp.login(3);
select pg_temp.expect_create_failure('Sin confirmar SA', '30-71234567-1', 'starter', 'P4101');
select pg_temp.login(4);
select pg_temp.expect_create_failure('Sin nombre SA', '30-71234567-1', 'starter', 'P4103');
select pg_temp.login(1);
select pg_temp.expect_create_failure('Responsable con perfil SA', '30-71234567-1', 'starter', 'P4104');
select pg_temp.login(5);
select pg_temp.expect_create_failure('Operador con perfil SA', '30-71234567-1', 'starter', 'P4104');
select pg_temp.login(6);
select pg_temp.expect_create_failure('Con solicitud pendiente SA', '30-71234567-1', 'starter', 'P4105');

select pg_temp.login(2);
select pg_temp.expect_create_failure('   ', '30-71234567-1', 'starter', 'P4106');
select pg_temp.expect_create_failure('X', '30-71234567-1', 'starter', 'P4106');
select pg_temp.expect_create_failure(repeat('a', 141), '30-71234567-1', 'starter', 'P4106');
select pg_temp.expect_create_failure('CUIT inválido SA', '30-71234567-8', 'starter', 'P4107');
select pg_temp.expect_create_failure('CUIT con letras SA', '30-7123456A-1', 'starter', 'P4107');
select pg_temp.expect_create_failure('CUIT corto SA', '3071234567', 'starter', 'P4107');
select pg_temp.expect_create_failure('CUIT nulo SA', null, 'starter', 'P4107');
-- Mismo CUIT que A, escrito sin guiones o con espacios: es la misma empresa.
select pg_temp.expect_create_failure('Duplicada SA', '30500010912', 'starter', 'P4108');
select pg_temp.expect_create_failure('Duplicada SA', ' 30 50001091 2 ', 'starter', 'P4108');
select pg_temp.expect_create_failure('Enterprise SA', '30-71234567-1', 'enterprise', 'P4109');
select pg_temp.expect_create_failure('Plan inexistente SA', '30-71234567-1', 'premium', 'P4109');
select pg_temp.expect_create_failure('Plan nulo SA', '30-71234567-1', null, 'P4109');

-- Atomicidad: falla el depósito y no queda ni la empresa, ni el perfil, ni el plan.
select pg_temp.login(2);
select pg_temp.expect_create_failure('Falla al final SA', '33693450239', 'starter', 'P0999');
reset role;
select pg_temp.assert_true(not exists (select 1 from public.companies where tax_id = '33-69345023-9'), 'la falla no deja la empresa');
select pg_temp.assert_true(not exists (select 1 from public.users where id = pg_temp.uid(2)), 'la falla no deja el perfil');
select pg_temp.assert_true(not exists (select 1 from public.company_plans p join public.companies c on c.id = p.company_id
  where c.tax_id = '33-69345023-9'), 'la falla no deja el plan');
drop trigger trz112_fail_warehouse on public.warehouses;
set local role authenticated;

/* ---------- Alta correcta: empresa X ---------- */

select pg_temp.login(2);
create temporary table x_company as select public.create_company_with_manager('  Nueva Empresa X SA  ', '30-71234567-1', 'growth') as id;

reset role;
select pg_temp.assert_true((select name = 'Nueva Empresa X SA' and tax_id = '30-71234567-1'
  from public.companies where id = (select id from x_company)), 'empresa creada con nombre recortado y CUIT normalizado');
select pg_temp.assert_true((select company_id = (select id from x_company) and role = 'logistics_manager'
  and name = 'Persona 2' and email = 'trz112-2@test.local' and revoked_at is null
  from public.users where id = pg_temp.uid(2)), 'el primer usuario queda como logistics_manager de X');
select pg_temp.assert_true((select plan_code = 'growth' and canceled_at is null
  from public.company_plans where company_id = (select id from x_company)), 'plan elegido asignado');
select pg_temp.assert_true((select count(*) = 1 and bool_and(code = 'DEP-01' and external_id is null and active)
  from public.warehouses where company_id = (select id from x_company)), 'X recibe DEP-01');
select pg_temp.assert_true(not exists (select 1 from public.erp_company_settings where company_id = (select id from x_company)),
  'X arranca sin ERP');
select pg_temp.assert_true(public.erp_company_provider((select id from x_company)) is null, 'X trabaja en modo manual');
set local role authenticated;

-- No se puede crear una segunda empresa.
select pg_temp.login(2);
select pg_temp.expect_create_failure('Segunda empresa SA', '20-12345678-6', 'starter', 'P4104');

-- Una solicitud rechazada no impide dar de alta la propia empresa.
select pg_temp.login(7);
select pg_temp.assert_true(public.create_company_with_manager('Empresa Y SA', '20-12345678-6', 'starter') is not null,
  'con una solicitud rechazada se puede dar de alta la empresa');

-- X aparece en el registro para que otros se sumen (US27).
select pg_temp.login(null);
select pg_temp.assert_true(exists (select 1 from public.get_registration_companies() where id = (select id from x_company)),
  'X aparece en el registro');

/* ---------- Sumarse a X (US27 + US30) ---------- */

select pg_temp.login(8);
insert into public.access_requests (user_id, company_id, requested_role)
  select pg_temp.uid(8), id, 'warehouse_operator' from x_company;

-- El responsable de A no ve ni aprueba la solicitud de X.
select pg_temp.login(1);
select pg_temp.assert_true(not exists (select 1 from public.get_pending_access_requests() where user_id = pg_temp.uid(8)),
  'A no ve las solicitudes de X');
do $$ begin
  perform public.approve_access_request((select id from public.access_requests where user_id = pg_temp.uid(8)));
  raise exception 'TRZ-112 alta: A no debería aprobar solicitudes de X';
exception when others then
  if sqlstate <> 'P3701' then raise; end if;
end $$;

-- El responsable de X la ve y la aprueba.
select pg_temp.login(2);
select pg_temp.assert_true((select count(*) = 1 from public.get_pending_access_requests()), 'X ve solo su solicitud');
reset role;
select pg_temp.login(2);
set local role authenticated;
select public.approve_access_request(r.request_id) from public.get_pending_access_requests() r;
reset role;
select pg_temp.assert_true((select company_id = (select id from x_company) and role = 'warehouse_operator'
  from public.users where id = pg_temp.uid(8)), 'el operador quedó en X');
insert into public.products (company_id, sku, name, unit_of_measure)
  select id, 'TRZ112-X', 'Producto de X', 'unidades' from x_company;
set local role authenticated;

/* ---------- Aislamiento entre A y X ---------- */

-- Responsable y operador de X: ven solo lo de X.
select pg_temp.login(2);
select pg_temp.assert_true((select array_agg(sku) from public.products where sku like 'TRZ112-%') = array['TRZ112-X'], 'X ve solo sus productos');
select pg_temp.assert_true((select bool_and(company_id = (select id from x_company)) and count(*) = 1 from public.warehouses), 'X ve solo su depósito');
select pg_temp.assert_true((select bool_and(company_id = (select id from x_company)) from public.users), 'X ve solo sus usuarios');
select pg_temp.assert_true((select count(*) = 1 and bool_and(company_id = (select id from x_company)) from public.company_plans), 'X ve solo su plan');
select pg_temp.assert_true(not exists (select 1 from public.access_requests where company_id <> (select id from x_company)), 'X no ve solicitudes de A');
select pg_temp.login(8);
select pg_temp.assert_true((select array_agg(sku) from public.products where sku like 'TRZ112-%') = array['TRZ112-X'], 'el operador de X ve solo productos de X');
select pg_temp.assert_true((select bool_and(company_id = (select id from x_company)) from public.warehouses), 'el operador de X ve solo depósitos de X');

-- Responsable y operador de A: no ven nada de X.
select pg_temp.login(1);
select pg_temp.assert_true((select array_agg(sku) from public.products where sku like 'TRZ112-%') = array['TRZ112-A'], 'A ve solo sus productos');
select pg_temp.assert_true(not exists (select 1 from public.warehouses where company_id = (select id from x_company)), 'A no ve el depósito de X');
select pg_temp.assert_true(not exists (select 1 from public.users where company_id = (select id from x_company)), 'A no ve usuarios de X');
select pg_temp.assert_true(not exists (select 1 from public.company_plans where company_id = (select id from x_company)), 'A no ve el plan de X');
select pg_temp.login(5);
select pg_temp.assert_true(not exists (select 1 from public.products where sku = 'TRZ112-X'), 'el operador de A no ve productos de X');

-- Nadie escribe en la empresa ajena.
select pg_temp.login(1);
update public.products set name = 'Pisado por A' where sku = 'TRZ112-X';
delete from public.products where sku = 'TRZ112-X';
reset role;
select pg_temp.assert_true((select name = 'Producto de X' from public.products where sku = 'TRZ112-X'), 'A no modifica ni borra productos de X');
set local role authenticated;
select pg_temp.login(1);
do $$ begin
  insert into public.products (company_id, sku, name, unit_of_measure)
    select id, 'TRZ112-INTRUSO', 'Intruso', 'unidades' from x_company;
  raise exception 'TRZ-112 alta: A no debería insertar productos en X';
exception when insufficient_privilege then null;
end $$;

-- La tabla de empresas no se escribe por la API: el alta pasa solo por la RPC.
do $$ begin
  insert into public.companies (name, tax_id) values ('Directa SA', '30-11111111-8');
  raise exception 'TRZ-112 alta: authenticated no debería insertar empresas';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;
