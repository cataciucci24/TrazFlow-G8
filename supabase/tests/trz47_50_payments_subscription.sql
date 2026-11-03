-- Ejecutar únicamente contra Supabase local migrado. Todos los datos se revierten.
begin;
create temporary table sub_ids as select gen_random_uuid() company_a, gen_random_uuid() company_b, gen_random_uuid() company_c,
 gen_random_uuid() manager_a, gen_random_uuid() manager_b, gen_random_uuid() manager_c, gen_random_uuid() driver, gen_random_uuid() pending_id,
 (now() at time zone 'America/Argentina/Buenos_Aires')::date today;
grant select on sub_ids to authenticated;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Subscription test: %', message; end if; end; $$;
create function pg_temp.pay(company uuid, status text, period_start date, period_end date, invoice text, id uuid default gen_random_uuid()) returns void language sql as $$
 insert into public.company_payments(id,company_id,plan_code,plan_name,billed_to,amount_cents,status,payment_date,period_start,period_end,invoice_number)
 values (id,company,'starter','Starter','Empresa',6900,status,period_start,period_start,period_end,invoice); $$;
insert into public.companies(id,name) select company_a,'Sub A' from sub_ids union all select company_b,'Sub B' from sub_ids union all select company_c,'Sub C' from sub_ids;
insert into auth.users(id,email) select id,id::text||'@subs.test' from sub_ids cross join lateral (values(manager_a),(manager_b),(manager_c),(driver)) x(id);
insert into public.users(id,company_id,name,email,role)
 select id,company,'Sub test',id::text||'@subs.test',role::public.user_role from sub_ids cross join lateral
 (values(manager_a,company_a,'logistics_manager'),(manager_b,company_b,'logistics_manager'),(manager_c,company_c,'logistics_manager'),(driver,company_a,'driver_operator')) x(id,company,role);
insert into public.company_plans(company_id,plan_code,assigned_at) select company_a,'starter',timestamptz '2026-10-01Z' from sub_ids union all select company_b,'starter',timestamptz '2026-10-01Z' from sub_ids;
select pg_temp.pay(company_a,'paid',today-40,today-11,'T-1') from sub_ids;
select pg_temp.pay(company_a,'paid',today-10,today+5,'T-2') from sub_ids;
select pg_temp.pay(company_a,'refunded',today+6,today+90,'T-3') from sub_ids;
select pg_temp.pay(company_a,'pending',today+6,today+35,null,pending_id) from sub_ids;
select pg_temp.pay(company_b,'paid',today-40,today-1,'T-4') from sub_ids;
do $$ begin
 begin perform pg_temp.pay((select company_a from sub_ids),'paid',current_date,current_date,null); raise exception 'pagado sin factura';
 exception when check_violation then null; end;
end $$;

-- Lectura aislada por empresa y por rol; escritura solo con service_role.
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager_a::text from sub_ids),true);
select pg_temp.check_true((select count(*)=4 and bool_and(company_id=(select company_a from sub_ids)) from public.company_payments),'logística ve solo lo propio');
select pg_temp.check_true((select count(*)=0 from public.get_company_subscription_access() where canceled_at is not null),'sin cancelar');
select set_config('request.jwt.claim.sub',(select driver::text from sub_ids),true);
select pg_temp.check_true((select count(*)=0 from public.company_payments),'chofer no ve pagos');
do $$ begin begin perform public.cancel_company_subscription(true); raise exception 'chofer autorizado'; exception when insufficient_privilege then null; end; end; $$;
reset role;
select pg_temp.check_true(not has_table_privilege('authenticated','public.company_payments','insert'),'no falsificar pagos');
select pg_temp.check_true(not has_function_privilege('anon','public.cancel_company_subscription(boolean)','execute'),'anónimo no cancela');

-- Cancelación: acceso hasta el último período pagado; un reembolso no cuenta.
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager_a::text from sub_ids),true);
select pg_temp.check_true(public.cancel_company_subscription(false)='confirmation_required','confirmación obligatoria');
select pg_temp.check_true(public.cancel_company_subscription(true)='canceled','cancela');
select pg_temp.check_true((select access_until=(select today+5 from sub_ids) and not ended and canceled_at is not null from public.get_company_subscription_access()),'sigue activo hasta el fin del período');
select pg_temp.check_true(public.cancel_company_subscription(true)='already_canceled','idempotente');
select pg_temp.check_true(public.change_company_plan('growth','starter','2026-10-01Z',gen_random_uuid(),true)='subscription_canceled','sin cambios de plan');
select set_config('request.jwt.claim.sub',(select driver::text from sub_ids),true);
select pg_temp.check_true((select access_until=(select today+5 from sub_ids) from public.get_company_subscription_access()),'el chofer conoce el vencimiento');
select set_config('request.jwt.claim.sub',(select manager_b::text from sub_ids),true);
select pg_temp.check_true(public.cancel_company_subscription(true)='no_paid_period','sin período vigente no cancela');
select set_config('request.jwt.claim.sub',(select manager_c::text from sub_ids),true);
select pg_temp.check_true(public.cancel_company_subscription(true)='unassigned','sin plan');
reset role;
select pg_temp.check_true((select canceled_at is null from public.company_plans where company_id=(select company_b from sub_ids)),'aislamiento entre empresas');

-- No se cobra el período siguiente.
select pg_temp.check_true((select status='canceled' from public.company_payments where id=(select pending_id from sub_ids)),'anula el cobro pendiente');
do $$ begin
 begin perform pg_temp.pay((select company_a from sub_ids),'pending',(select today+6 from sub_ids),(select today+35 from sub_ids),null); raise exception 'cobro futuro aceptado';
 exception when check_violation then null; end;
 begin update public.company_payments set status='pending' where id=(select pending_id from sub_ids); raise exception 'cobro reactivado';
 exception when check_violation then null; end;
end $$;
select pg_temp.pay(company_a,'failed',today+6,today+35,null) from sub_ids;

-- El último día todavía tiene acceso; el siguiente, no.
update public.company_plans set access_until=(select today from sub_ids) where company_id=(select company_a from sub_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager_a::text from sub_ids),true);
select pg_temp.check_true((select not ended from public.get_company_subscription_access()),'último día con acceso');
reset role;
update public.company_plans set access_until=(select today-1 from sub_ids) where company_id=(select company_a from sub_ids);
set local role authenticated;
select pg_temp.check_true((select ended from public.get_company_subscription_access()),'terminó el período');
select pg_temp.check_true((select count(*)>=4 from public.company_payments),'las facturas siguen legibles');
reset role;
rollback;
