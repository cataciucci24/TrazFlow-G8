-- Ejecutar sobre una base LOCAL migrada, como los demás tests SQL:
-- docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- pasando este archivo por stdin. Los fixtures se revierten al finalizar.
begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'US29 test failed: %', message; end if;
end;
$$;

-- Dos responsables, dos operadores y cuatro solicitantes sin perfil.
insert into auth.users (id, email)
select ('36000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'us29-' || n || '@test.local'
from generate_series(1, 8) n;

insert into public.companies (id, name) values
  ('36000000-0000-0000-0001-000000000001', 'US29 A'),
  ('36000000-0000-0000-0001-000000000002', 'US29 B');

insert into public.users (id, company_id, name, email, role)
select ('36000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 2 then '36000000-0000-0000-0001-000000000002'::uuid
    else '36000000-0000-0000-0001-000000000001'::uuid end,
  'US29 ' || n, 'us29-' || n || '@test.local',
  case when n <= 2 then 'logistics_manager'::public.user_role
    when n = 3 then 'warehouse_operator'::public.user_role
    else 'distributor_operator'::public.user_role end
from generate_series(1, 4) n;

insert into public.access_requests (user_id, company_id, requested_role, status)
select ('36000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 6 then '36000000-0000-0000-0001-000000000002'::uuid
    else '36000000-0000-0000-0001-000000000001'::uuid end,
  'warehouse_operator',
  case when n = 7 then 'approved' when n = 8 then 'rejected' else 'pending' end
from generate_series(5, 8) n;

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.get_pending_access_requests()', 'EXECUTE'),
  'anon no debe tener EXECUTE, tampoco por PUBLIC');

set local role authenticated;
select set_config('request.jwt.claim.sub', '36000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 1 from public.get_pending_access_requests()),
  'manager A solo ve pending de A, excluyendo B y approved/rejected');
select pg_temp.assert_true(
  exists (select 1 from public.get_pending_access_requests()
    where user_id = '36000000-0000-0000-0000-000000000005'
      and email = 'us29-5@test.local' and company_name = 'US29 A'
      and company_id = '36000000-0000-0000-0001-000000000001'
      and requested_role = 'warehouse_operator' and status = 'pending'
      and request_id is not null and created_at is not null),
  'proyección correcta, incluyendo email de Auth sin perfil del solicitante');
select pg_temp.assert_true(
  (select count(*) = 0 from public.access_requests),
  'la RPC no amplía SELECT directo del manager');

select set_config('request.jwt.claim.sub', '36000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(company_name = 'US29 B') from public.get_pending_access_requests()),
  'manager B solo ve su empresa');

-- Cada invocación directa no autorizada debe fallar con insufficient_privilege.
do $$
declare n integer;
begin
  for n in 3..5 loop
    perform set_config('request.jwt.claim.sub', '36000000-0000-0000-0000-' || lpad(n::text, 12, '0'), true);
    begin
      perform * from public.get_pending_access_requests();
      raise exception 'US29: RPC permitió acceso al usuario %', n;
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform * from public.get_pending_access_requests();
    raise exception 'US29: RPC permitió acceso sin identidad';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- La lectura propia continúa funcionando en los tres estados y oculta las ajenas.
do $$
declare n integer; own_id uuid;
begin
  for n in 5..8 loop
    own_id := ('36000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
    perform set_config('request.jwt.claim.sub', own_id::text, true);
    perform pg_temp.assert_true(
      (select count(*) = 1 and bool_and(user_id = own_id) from public.access_requests),
      'RLS debe mostrar únicamente la solicitud propia');
  end loop;
end;
$$;

reset role;
rollback;
