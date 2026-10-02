-- Solo base LOCAL migrada. Ejecutar mediante psql -v ON_ERROR_STOP=1 -f este_archivo.
-- Todos los fixtures se revierten. Doble aprobación secuencial, NO concurrencia real.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'US30: %', message; end if;
end; $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('37000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.expect_failure(request_id uuid, expected_code text) returns void language plpgsql as $$
begin
  begin
    perform public.approve_access_request(request_id);
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise;
  end;
  raise exception 'US30: aprobación debió fallar con %', expected_code;
end; $$;

insert into public.companies(id, name) values
  ('37000000-0000-0000-0001-000000000001', 'US30 A'),
  ('37000000-0000-0000-0001-000000000002', 'US30 B');
insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.uid(n), 'us30-' || n || '@test.local',
  jsonb_build_object('name', '  María José O''Connor  ', 'requested_role', 'logistics_manager', 'company_id', 'untrusted')
from generate_series(1, 15) n;
update auth.users set raw_user_meta_data = '{}' where id = pg_temp.uid(9);
update auth.users set raw_user_meta_data = '{"name":"   "}' where id = pg_temp.uid(10);
update auth.users set raw_user_meta_data = '{"name":123}' where id = pg_temp.uid(11);
update auth.users set raw_user_meta_data = jsonb_build_object('name', repeat('a', 101)) where id = pg_temp.uid(12);

insert into public.users(id, company_id, name, email, role)
select pg_temp.uid(n),
  case when n = 2 then '37000000-0000-0000-0001-000000000002'::uuid
    else '37000000-0000-0000-0001-000000000001'::uuid end,
  'Perfil anterior', 'us30-' || n || '@test.local',
  case when n in (1,2) then 'logistics_manager'::public.user_role
    when n = 4 then 'distributor_operator'::public.user_role else 'warehouse_operator'::public.user_role end
from unnest(array[1,2,3,4,8]) n;

insert into public.access_requests(id, user_id, company_id, requested_role, status)
select pg_temp.uid(n), pg_temp.uid(n), '37000000-0000-0000-0001-000000000001',
  case when n = 6 then 'distributor_operator' else 'warehouse_operator' end,
  case when n = 7 then 'rejected' else 'pending' end
from generate_series(5, 15) n;

select pg_temp.assert_true(has_function_privilege('authenticated', 'public.approve_access_request(uuid)', 'EXECUTE'), 'authenticated puede invocar');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.approve_access_request(uuid)', 'EXECUTE'), 'anon/PUBLIC sin ejecución');
select pg_temp.assert_true(not has_function_privilege('service_role', 'public.approve_access_request(uuid)', 'EXECUTE'), 'sin grant a service_role');

set local role authenticated;
-- Manager de otra empresa, ambos operadores y usuario sin perfil.
do $$ declare n integer; begin
  for n in 2..5 loop
    perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
    perform pg_temp.expect_failure(pg_temp.uid(5), case when n = 2 then 'P3701' else '42501' end);
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_failure(pg_temp.uid(5), '42501');
end; $$;

select set_config('request.jwt.claim.sub', pg_temp.uid(1)::text, true);
select public.approve_access_request(pg_temp.uid(5));
select public.approve_access_request(pg_temp.uid(6));
select pg_temp.assert_true((select count(*) = 2 from public.users where id in (pg_temp.uid(5), pg_temp.uid(6))), 'un perfil por solicitante');
select pg_temp.assert_true((select bool_and(company_id = '37000000-0000-0000-0001-000000000001'::uuid
  and name = 'María José O''Connor' and email = case when id = pg_temp.uid(5) then 'us30-5@test.local' else 'us30-6@test.local' end
  and role = case when id = pg_temp.uid(5) then 'warehouse_operator'::public.user_role else 'distributor_operator'::public.user_role end)
  from public.users where id in (pg_temp.uid(5), pg_temp.uid(6))), 'perfil desde solicitud/Auth; metadata no asigna rol/empresa');
select pg_temp.assert_true(not exists(select 1 from public.get_pending_access_requests() where request_id in (pg_temp.uid(5), pg_temp.uid(6))), 'aprobadas desaparecen de pendientes');
select pg_temp.expect_failure(pg_temp.uid(5), 'P3702');
select pg_temp.expect_failure(pg_temp.uid(7), 'P3702');
select pg_temp.expect_failure(pg_temp.uid(8), 'P3706');
select pg_temp.assert_true((select name = 'Perfil anterior' and role = 'warehouse_operator' from public.users where id = pg_temp.uid(8)), 'no sobrescribir perfil existente');
select pg_temp.expect_failure(pg_temp.uid(9), 'P3705');
select pg_temp.expect_failure(pg_temp.uid(10), 'P3705');
select pg_temp.expect_failure(pg_temp.uid(11), 'P3705');
select pg_temp.expect_failure(pg_temp.uid(12), 'P3705');

reset role;
select pg_temp.assert_true((select count(*) = 2 and bool_and(status = 'approved') from public.access_requests where id in (pg_temp.uid(5), pg_temp.uid(6))), 'estado aprobado');
select pg_temp.assert_true(not exists(select 1 from public.distributor_users where user_id = pg_temp.uid(6)), 'sin vinculación automática');
select pg_temp.assert_true((select bool_and(status = 'pending') from public.access_requests where id in (pg_temp.uid(8),pg_temp.uid(9),pg_temp.uid(10),pg_temp.uid(11),pg_temp.uid(12))), 'fallos mantienen pending');
select pg_temp.assert_true(not exists(select 1 from public.users where id in (pg_temp.uid(9),pg_temp.uid(10),pg_temp.uid(11),pg_temp.uid(12))), 'fallos no crean perfil');

-- Fallo inyectado DESPUÉS del INSERT de perfil: verifica rollback de toda la RPC.
create function pg_temp.fail_approval_update() returns trigger language plpgsql as $$
begin
  if new.id = '37000000-0000-0000-0000-000000000013'::uuid then
    raise exception 'US30 fallo inducido' using errcode = 'P3799';
  end if;
  return new;
end; $$;
create trigger us30_fail_update before update on public.access_requests
for each row execute function pg_temp.fail_approval_update();
set local role authenticated;
select pg_temp.expect_failure(pg_temp.uid(13), 'P3799');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.users where id = pg_temp.uid(13)), 'rollback revierte perfil insertado');
select pg_temp.assert_true((select status = 'pending' from public.access_requests where id = pg_temp.uid(13)), 'rollback mantiene pending');

-- Lectura propia y copia inmutable del nombre operativo tras aprobación.
update auth.users set raw_user_meta_data = '{"name":"Otro nombre"}' where id = pg_temp.uid(5);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.uid(5)::text, true);
select pg_temp.assert_true((select count(*) = 1 and bool_and(status = 'approved') from public.access_requests), 'TRZ-35 conserva lectura propia');
select pg_temp.assert_true((select name = 'María José O''Connor' from public.users where id = pg_temp.uid(5)), 'metadata posterior no cambia perfil');
reset role;
rollback;
