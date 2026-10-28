-- Ejecutar sobre la base migrada. El rollback elimina todos los fixtures.
begin;

create temporary table plan_test_ids as select
  gen_random_uuid() as company_a, gen_random_uuid() as company_b,
  gen_random_uuid() as manager_a, gen_random_uuid() as manager_b,
  gen_random_uuid() as operator_a, gen_random_uuid() as driver_a;
grant select on plan_test_ids to authenticated;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'Plans test failed: %', message; end if;
end;
$$;

insert into public.companies(id, name)
  select company_a, 'Plans test A' from plan_test_ids union all
  select company_b, 'Plans test B' from plan_test_ids;
insert into auth.users(id, email)
  select manager_a, manager_a::text || '@plans.test' from plan_test_ids union all
  select manager_b, manager_b::text || '@plans.test' from plan_test_ids union all
  select operator_a, operator_a::text || '@plans.test' from plan_test_ids union all
  select driver_a, driver_a::text || '@plans.test' from plan_test_ids;
insert into public.users(id, company_id, name, email, role)
  select manager_a, company_a, 'Manager A', manager_a::text || '@plans.test', 'logistics_manager'::public.user_role from plan_test_ids union all
  select manager_b, company_b, 'Manager B', manager_b::text || '@plans.test', 'logistics_manager'::public.user_role from plan_test_ids union all
  select operator_a, company_a, 'Operator A', operator_a::text || '@plans.test', 'warehouse_operator'::public.user_role from plan_test_ids union all
  select driver_a, company_a, 'Driver A', driver_a::text || '@plans.test', 'driver_operator'::public.user_role from plan_test_ids;

select pg_temp.assert_true((select count(*) from public.company_plans where company_id in (select company_a from plan_test_ids)) = 0, 'no hay un plan asignado por defecto');
insert into public.company_plans(company_id, plan_code)
  select company_a, 'starter' from plan_test_ids union all
  select company_b, 'growth' from plan_test_ids;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_a::text from plan_test_ids), true);
select pg_temp.assert_true((select count(*) from public.subscription_plans) = 3, 'logística puede comparar los tres planes');
select pg_temp.assert_true((select count(*) from public.company_plans) = 1, 'solo se ve la asignación de la propia empresa');
select pg_temp.assert_true((select plan_code from public.company_plans) = 'starter', 'se conserva el plan real');
select pg_temp.assert_true((select monthly_price_cents from public.subscription_plans where code='starter') = 6900, 'precio mensual Starter');
select pg_temp.assert_true((select max_pallets_per_month from public.subscription_plans where code='growth') = 3000, 'límite mensual Growth');
select pg_temp.assert_true((select max_operators is null and max_pallets_per_month is null and monthly_price_cents is null from public.subscription_plans where code='enterprise'), 'Enterprise ilimitado y a medida');

do $$
begin
  begin
    update public.company_plans set plan_code='enterprise';
    raise exception 'Planes: se permitió cambiar el plan desde la sesión';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.subscription_plans set monthly_price_cents=0;
    raise exception 'Planes: se permitió editar precios desde la sesión';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select operator_a::text from plan_test_ids), true);
select pg_temp.assert_true((select count(*) from public.subscription_plans) = 0, 'depósito no accede al catálogo comercial');
select pg_temp.assert_true((select count(*) from public.company_plans) = 0, 'depósito no accede a asignaciones');

select set_config('request.jwt.claim.sub', (select driver_a::text from plan_test_ids), true);
select pg_temp.assert_true((select count(*) from public.subscription_plans) = 0, 'chofer no accede al catálogo comercial');
select pg_temp.assert_true((select count(*) from public.company_plans) = 0, 'chofer no accede a asignaciones');

reset role;
update public.users set revoked_at=now() where id=(select manager_a from plan_test_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_a::text from plan_test_ids), true);
select pg_temp.assert_true((select count(*) from public.subscription_plans) = 0, 'un acceso revocado no consulta el catálogo');
select pg_temp.assert_true((select count(*) from public.company_plans) = 0, 'un acceso revocado no consulta asignaciones');
reset role;
select pg_temp.assert_true(not has_table_privilege('anon', 'public.company_plans', 'select'), 'anon sin acceso');

rollback;
