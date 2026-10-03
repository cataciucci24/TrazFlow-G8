-- TRZ-19 (US17) y TRZ-38 (US31). Solo base LOCAL migrada.
-- Ejecutar mediante psql -v ON_ERROR_STOP=1 -f este_archivo. Todos los fixtures se revierten.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'US17/US31: %', message; end if;
end; $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('38000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case when n is null then '' else pg_temp.uid(n)::text end, true);
$$;
-- Ejecuta una llamada y exige que falle con el código indicado.
create function pg_temp.expect_failure(call text, expected_code text) returns void language plpgsql as $$
begin
  begin
    execute call;
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise;
  end;
  raise exception 'US17/US31: % debió fallar con %', call, expected_code;
end; $$;

-- Empresas A y B. Usuarios:
--  1 manager A · 2 manager B · 3 depósito A · 4,5 distribuidor A · 6 distribuidor B · 7 manager A (segundo)
insert into public.companies(id, name) values
  ('38000000-0000-0000-0001-000000000001', 'US17 A'),
  ('38000000-0000-0000-0001-000000000002', 'US17 B');
insert into auth.users(id, email)
select pg_temp.uid(n), 'us17-' || n || '@test.local' from generate_series(1, 9) n;
insert into public.users(id, company_id, name, email, role)
select pg_temp.uid(n),
  case when n in (2, 6) then '38000000-0000-0000-0001-000000000002'::uuid
    else '38000000-0000-0000-0001-000000000001'::uuid end,
  'Usuario ' || n, 'us17-' || n || '@test.local',
  case when n in (1, 2, 7) then 'logistics_manager'::public.user_role
    when n = 3 then 'warehouse_operator'::public.user_role
    else 'distributor_operator'::public.user_role end
from generate_series(1, 7) n;
insert into public.distributors(id, company_id, name) values
  ('38000000-0000-0000-0002-000000000001', '38000000-0000-0000-0001-000000000001', 'Centro A'),
  ('38000000-0000-0000-0002-000000000002', '38000000-0000-0000-0001-000000000001', 'Norte A'),
  ('38000000-0000-0000-0002-000000000003', '38000000-0000-0000-0001-000000000002', 'Centro B');
insert into public.access_requests(id, user_id, company_id, requested_role, status) values
  (pg_temp.uid(8), pg_temp.uid(8), '38000000-0000-0000-0001-000000000001', 'warehouse_operator', 'pending'),
  (pg_temp.uid(9), pg_temp.uid(9), '38000000-0000-0000-0001-000000000002', 'warehouse_operator', 'pending');

select pg_temp.assert_true(not has_function_privilege('anon', 'public.assign_operator_distributor(uuid, uuid)', 'EXECUTE'), 'anon sin ejecución (assign)');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.revoke_operator_access(uuid)', 'EXECUTE'), 'anon sin ejecución (revoke)');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.active_manager_company_id()', 'EXECUTE'), 'helper interno no expuesto');

set local role authenticated;

-- ---------- TRZ-19: vincular ----------
-- Solo un manager activo de la empresa.
select pg_temp.as_user(3);
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(4), '38000000-0000-0000-0002-000000000001'), '42501');
select pg_temp.as_user(null);
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(4), '38000000-0000-0000-0002-000000000001'), '42501');

select pg_temp.as_user(1);
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(6), '38000000-0000-0000-0002-000000000001'), 'P3801'); -- operador de otra empresa
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(3), '38000000-0000-0000-0002-000000000001'), 'P3802'); -- operador de depósito
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(7), '38000000-0000-0000-0002-000000000001'), 'P3802'); -- otro manager
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(4), '38000000-0000-0000-0002-000000000003'), 'P3803'); -- distribuidor de otra empresa

select public.assign_operator_distributor(pg_temp.uid(4), '38000000-0000-0000-0002-000000000001');
select public.assign_operator_distributor(pg_temp.uid(5), '38000000-0000-0000-0002-000000000001');

-- Aviso de reasignación: órdenes en tránsito y otros operadores del distribuidor actual.
reset role;
insert into public.dispatch_orders(id, company_id, distributor_id, status, created_by, estimated_dispatch_date) values
  ('38000000-0000-0000-0003-000000000001', '38000000-0000-0000-0001-000000000001', '38000000-0000-0000-0002-000000000001', 'confirmed', pg_temp.uid(1), current_date),
  ('38000000-0000-0000-0003-000000000002', '38000000-0000-0000-0001-000000000001', '38000000-0000-0000-0002-000000000001', 'draft', pg_temp.uid(1), current_date);
set local role authenticated;
select pg_temp.as_user(1);
select pg_temp.assert_true((select in_transit_orders = 1 and other_active_operators = 1 and distributor_name = 'Centro A'
  from public.get_company_operators() where user_id = pg_temp.uid(4)), 'listado informa órdenes en tránsito y otros operadores');
select pg_temp.assert_true((select count(*) = 3 from public.get_company_operators()), 'lista solo operadores de la empresa (sin managers)');

-- El operador vinculado ve su distribuidor.
select pg_temp.as_user(4);
select pg_temp.assert_true(public.operates_for_distributor('38000000-0000-0000-0002-000000000001'), 'operador vinculado opera para Centro A');

-- Reasignar reemplaza el vínculo (un solo distribuidor por operador).
select pg_temp.as_user(1);
select public.assign_operator_distributor(pg_temp.uid(4), '38000000-0000-0000-0002-000000000002');
select pg_temp.as_user(4);
select pg_temp.assert_true(not public.operates_for_distributor('38000000-0000-0000-0002-000000000001')
  and public.operates_for_distributor('38000000-0000-0000-0002-000000000002'), 'reasignación mueve el vínculo');
reset role;
select pg_temp.assert_true((select count(*) = 1 from public.distributor_users where user_id = pg_temp.uid(4)), 'un único vínculo tras reasignar');
set local role authenticated;

-- Los managers de otra empresa no ven estos operadores.
select pg_temp.as_user(2);
select pg_temp.assert_true(not exists (select 1 from public.get_company_operators() where user_id = pg_temp.uid(4)), 'aislamiento entre empresas');
select pg_temp.as_user(3);
select pg_temp.expect_failure('select * from public.get_company_operators()', '42501');

-- ---------- TRZ-38: rechazar ----------
select pg_temp.as_user(1);
select pg_temp.expect_failure(format('select public.reject_access_request(%L)', pg_temp.uid(9)), 'P3811'); -- solicitud de otra empresa
select public.reject_access_request(pg_temp.uid(8));
select pg_temp.expect_failure(format('select public.reject_access_request(%L)', pg_temp.uid(8)), 'P3812');
select pg_temp.expect_failure(format('select public.approve_access_request(%L)', pg_temp.uid(8)), 'P3702'); -- rechazada no se aprueba
select pg_temp.as_user(8);
select pg_temp.assert_true((select status = 'rejected' from public.access_requests), 'solicitante ve su rechazo');

-- ---------- TRZ-38: revocar y restaurar ----------
select pg_temp.as_user(1);
select pg_temp.expect_failure(format('select public.revoke_operator_access(%L)', pg_temp.uid(7)), 'P3822'); -- otro manager
select pg_temp.expect_failure(format('select public.revoke_operator_access(%L)', pg_temp.uid(1)), 'P3822'); -- a sí mismo
select pg_temp.expect_failure(format('select public.revoke_operator_access(%L)', pg_temp.uid(6)), 'P3821'); -- otra empresa
select public.revoke_operator_access(pg_temp.uid(5));
select pg_temp.expect_failure(format('select public.revoke_operator_access(%L)', pg_temp.uid(5)), 'P3823');
select pg_temp.expect_failure(format('select public.assign_operator_distributor(%L, %L)', pg_temp.uid(5), '38000000-0000-0000-0002-000000000001'), 'P3804');

-- El revocado pierde todo acceso, pero puede leer su propia fila.
select pg_temp.as_user(5);
select pg_temp.assert_true(public.auth_company_id() is null and public.auth_role() is null, 'helpers ignoran perfil revocado');
select pg_temp.assert_true(not public.operates_for_distributor('38000000-0000-0000-0002-000000000001'), 'revocado no opera');
select pg_temp.assert_true((select count(*) = 0 from public.dispatch_orders), 'revocado no ve órdenes');
select pg_temp.assert_true((select count(*) = 1 and bool_and(revoked_at is not null) from public.users), 'revocado solo ve su propia fila');
reset role;
select pg_temp.assert_true(not exists (select 1 from public.distributor_users where user_id = pg_temp.uid(5)), 'revocar borra el vínculo');
select pg_temp.assert_true(exists (select 1 from public.users where id = pg_temp.uid(5)), 'revocar no borra el perfil');
set local role authenticated;

select pg_temp.as_user(1);
select pg_temp.assert_true((select other_active_operators = 0 from public.get_company_operators() where user_id = pg_temp.uid(4)), 'revocados no cuentan como operadores activos');
select public.restore_operator_access(pg_temp.uid(5));
select pg_temp.expect_failure(format('select public.restore_operator_access(%L)', pg_temp.uid(5)), 'P3824');
select pg_temp.as_user(5);
select pg_temp.assert_true(public.auth_role() = 'distributor_operator', 'restaurado recupera el rol');
select pg_temp.assert_true(not public.operates_for_distributor('38000000-0000-0000-0002-000000000001'), 'restaurado vuelve sin distribuidor');

reset role;
rollback;
