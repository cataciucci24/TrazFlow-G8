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


-- Fechas de borde de mes argentino, no del calendario UTC.
create temporary table usage_dates as select
 date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires' as first,
 (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') + interval '1 month') at time zone 'America/Argentina/Buenos_Aires' as next;
insert into public.warehouses(company_id, code, name) select company_a, 'TEST', 'Test' from plan_test_ids;
insert into public.products(company_id, sku, name, unit_of_measure) select company_a, 'PLAN-TEST', 'Test', 'unidades' from plan_test_ids;
insert into public.batches(product_id, company_id, batch_number, quantity)
 select p.id, p.company_id, 'PLAN-TEST', 0 from public.products p where p.sku='PLAN-TEST' and p.company_id=(select company_a from plan_test_ids);
insert into public.pallets(company_id, batch_id, warehouse_code, quantity, created_at)
 select b.company_id, b.id, 'TEST', 99, d.first from public.batches b cross join usage_dates d
 where b.company_id=(select company_a from plan_test_ids);
-- Elimina el pallet físico; debe conservar una alta, no 99 unidades.
delete from public.pallets where company_id=(select company_a from plan_test_ids);
insert into public.plan_pallet_registrations values
 (gen_random_uuid(), (select company_a from plan_test_ids), (select first - interval '1 microsecond' from usage_dates)),
 (gen_random_uuid(), (select company_a from plan_test_ids), (select next - interval '1 microsecond' from usage_dates)),
 (gen_random_uuid(), (select company_a from plan_test_ids), (select next from usage_dates)),
 (gen_random_uuid(), (select company_b from plan_test_ids), now());
set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_a::text from plan_test_ids), true);
select pg_temp.assert_true((select operators=2 and pallets=2 from public.get_company_plan_usage()), 'cuenta operadores activos y altas del mes; conserva eliminados; aísla empresa');
reset role;
update public.users set revoked_at=now() where id=(select operator_a from plan_test_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_a::text from plan_test_ids), true);
select pg_temp.assert_true((select operators=1 from public.get_company_plan_usage()), 'no cuenta revocados ni logística');
select set_config('request.jwt.claim.sub', (select manager_b::text from plan_test_ids), true);
select pg_temp.assert_true((select operators=0 and pallets=1 from public.get_company_plan_usage()), 'otra empresa solo consulta sus datos');
select set_config('request.jwt.claim.sub', (select operator_a::text from plan_test_ids), true);
do $$ begin
 begin perform public.get_company_plan_usage(); raise exception 'depósito autorizado incorrectamente';
 exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub', (select driver_a::text from plan_test_ids), true);
do $$ begin
 begin perform public.get_company_plan_usage(); raise exception 'chofer autorizado incorrectamente';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
update public.users set revoked_at=now() where id=(select manager_a from plan_test_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_a::text from plan_test_ids), true);
do $$ begin
 begin perform public.get_company_plan_usage(); raise exception 'responsable revocado autorizado';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.plan_pallet_registrations','insert'), 'no se puede falsificar consumo');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.plan_pallet_registrations','delete'), 'no se puede borrar consumo');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_company_plan_usage()','execute'), 'anon sin acceso');
update public.plan_usage_tracking set started_at = now();
set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_b::text from plan_test_ids), true);
select pg_temp.assert_true((select not pallets_complete from public.get_company_plan_usage()), 'mes de transición incompleto');
reset role;
update public.plan_usage_tracking set started_at = (select first - interval '1 month' from usage_dates);
set local role authenticated;
select pg_temp.assert_true((select pallets_complete from public.get_company_plan_usage()), 'mes posterior con seguimiento completo');
reset role;
rollback;
