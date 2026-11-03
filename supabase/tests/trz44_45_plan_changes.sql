-- Ejecutar únicamente contra Supabase local migrado. Todos los datos se revierten.
begin;
create temporary table change_ids as select gen_random_uuid() company_a, gen_random_uuid() company_b,
 gen_random_uuid() manager_a, gen_random_uuid() manager_b, gen_random_uuid() driver, gen_random_uuid() warehouse,
 gen_random_uuid() request_a, gen_random_uuid() request_b;
grant select on change_ids to authenticated;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Plan change test: %', message; end if; end; $$;
insert into public.companies(id,name) select company_a,'Plan change A' from change_ids union all select company_b,'Plan change B' from change_ids;
insert into auth.users(id,email) select id,id::text||'@plans.test' from change_ids cross join lateral (values(manager_a),(manager_b),(driver),(warehouse)) x(id);
insert into public.users(id,company_id,name,email,role)
 select id,company,'Plan test',id::text||'@plans.test',role::public.user_role from change_ids cross join lateral
 (values(manager_a,company_a,'logistics_manager'),(manager_b,company_b,'logistics_manager'),(driver,company_a,'driver_operator'),(warehouse,company_a,'warehouse_operator')) x(id,company,role);
insert into public.company_plans(company_id,plan_code,assigned_at) select company_a,'starter',timestamptz '2026-10-01T00:00:00Z' from change_ids union all select company_b,'growth',timestamptz '2026-10-01T00:00:00Z' from change_ids;
insert into public.plan_pallet_registrations select gen_random_uuid(),company_a,now() from change_ids;
create temporary table before_usage as select count(*) n from public.plan_pallet_registrations where company_id=(select company_a from change_ids);
grant select on before_usage to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager_a::text from change_ids),true);
select pg_temp.check_true(public.change_company_plan('growth','starter','2026-10-01Z',(select request_a from change_ids),false)='confirmation_required','confirmación obligatoria');
select pg_temp.check_true(public.change_company_plan('enterprise','starter','2026-10-01Z',gen_random_uuid(),true)='commercial_required','Enterprise restringido');
select pg_temp.check_true(public.change_company_plan('missing','starter','2026-10-01Z',gen_random_uuid(),true)='invalid_plan','catálogo vigente');
select pg_temp.check_true(public.change_company_plan('starter','starter','2026-10-01Z',gen_random_uuid(),true)='same_plan','mismo plan');
select pg_temp.check_true(public.change_company_plan('growth','starter','2026-10-01Z',(select request_a from change_ids),true)='changed','subida');
create temporary table after_upgrade as select assigned_at from public.company_plans where company_id=(select company_a from change_ids);
select pg_temp.check_true(public.change_company_plan('growth','starter','2026-10-01Z',(select request_a from change_ids),true)='already_applied','reintento idempotente');
select pg_temp.check_true((select assigned_at=(select assigned_at from after_upgrade) from public.company_plans where company_id=(select company_a from change_ids)),'reintento conserva fecha');
select pg_temp.check_true(public.change_company_plan('growth','starter','2026-10-01Z',gen_random_uuid(),true)='stale','resumen obsoleto');
select pg_temp.check_true(public.change_company_plan('starter','growth',(select assigned_at from after_upgrade),(select request_b from change_ids),true)='changed','bajada inmediata');
select pg_temp.check_true(public.change_company_plan('growth','starter','2026-10-01Z',(select request_a from change_ids),true)='stale','replay antiguo no reaplica tras bajada');
select set_config('request.jwt.claim.sub',(select manager_b::text from change_ids),true);
select pg_temp.check_true((select plan_code='growth' and assigned_at='2026-10-01Z' from public.company_plans where company_id=(select company_b from change_ids)),'aislamiento entre empresas');
select set_config('request.jwt.claim.sub',(select driver::text from change_ids),true);
do $$ begin begin perform public.change_company_plan('growth','starter',now(),gen_random_uuid(),true); raise exception 'chofer autorizado'; exception when insufficient_privilege then null; end; end; $$;
select set_config('request.jwt.claim.sub',(select warehouse::text from change_ids),true);
do $$ begin begin perform public.change_company_plan('growth','starter',now(),gen_random_uuid(),true); raise exception 'depósito autorizado'; exception when insufficient_privilege then null; end; end; $$;
reset role;
select pg_temp.check_true((select count(*)=(select n from before_usage) from public.plan_pallet_registrations where company_id=(select company_a from change_ids)),'consumo intacto');
update public.users set revoked_at=now() where id=(select manager_a from change_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager_a::text from change_ids),true);
do $$ begin begin perform public.change_company_plan('growth','starter',now(),gen_random_uuid(),true); raise exception 'revocado autorizado'; exception when insufficient_privilege then null; end; end; $$;
reset role;
delete from public.company_plans where company_id=(select company_b from change_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager_b::text from change_ids),true);
select pg_temp.check_true(public.change_company_plan('starter','growth',now(),gen_random_uuid(),true)='unassigned','sin asignación no puede cambiar');
reset role;
select pg_temp.check_true(not has_table_privilege('authenticated','public.company_plans','update'),'escritura directa prohibida');
select pg_temp.check_true(not has_table_privilege('authenticated','public.company_plan_change_requests','insert'),'no falsificar solicitudes');
select pg_temp.check_true(not has_function_privilege('anon','public.change_company_plan(text,text,timestamptz,uuid,boolean)','execute'),'anon sin permisos');
rollback;
