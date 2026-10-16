-- TRZ-90: stock de distribuidoras por lote y niveles de vencimiento por empresa. Solo base LOCAL migrada.
-- Ejecutar mediante psql -v ON_ERROR_STOP=1 -f este_archivo. Todos los fixtures se revierten.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'TRZ-90: %', message; end if;
end; $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('90000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', case when n is null then '' else pg_temp.uid(n)::text end, true);
$$;
create function pg_temp.expect_failure(call text, expected_code text) returns void language plpgsql as $$
begin
  begin
    execute call;
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise;
  end;
  raise exception 'TRZ-90: % debió fallar con %', call, expected_code;
end; $$;

-- Empresas A y B. Usuarios: 1 manager A · 2, 3, 5 chofer A · 4 depósito A · 6 manager B
insert into public.companies(id, name) values
  ('90000000-0000-0000-0001-000000000001', 'TRZ-90 A'),
  ('90000000-0000-0000-0001-000000000002', 'TRZ-90 B');
insert into auth.users(id, email)
select pg_temp.uid(n), 'trz90-' || n || '@test.local' from generate_series(1, 6) n;
insert into public.users(id, company_id, name, email, role)
select pg_temp.uid(n),
  case when n = 6 then '90000000-0000-0000-0001-000000000002'::uuid else '90000000-0000-0000-0001-000000000001'::uuid end,
  'Usuario ' || n, 'trz90-' || n || '@test.local',
  case when n in (1, 6) then 'logistics_manager'::public.user_role
    when n = 4 then 'warehouse_operator'::public.user_role
    else 'driver_operator'::public.user_role end
from generate_series(1, 6) n;
insert into public.distributors(id, company_id, name) values
  ('90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0001-000000000001', 'Norte'),
  ('90000000-0000-0000-0002-000000000002', '90000000-0000-0000-0001-000000000001', 'Sur');
insert into public.products(id, company_id, sku, name, unit_of_measure) values
  ('90000000-0000-0000-0003-000000000001', '90000000-0000-0000-0001-000000000001', 'TRZ90-HAR', 'Harina', 'kilogramos'),
  ('90000000-0000-0000-0003-000000000002', '90000000-0000-0000-0001-000000000001', 'TRZ90-ACE', 'Aceite', 'unidades'),
  ('90000000-0000-0000-0003-000000000003', '90000000-0000-0000-0001-000000000002', 'TRZ90-B', 'Producto B', 'unidades');
insert into public.batches(id, product_id, batch_number, expiration_date, quantity) values
  ('90000000-0000-0000-0004-000000000001', '90000000-0000-0000-0003-000000000001', 'H-1', current_date + 20, 100),
  ('90000000-0000-0000-0004-000000000002', '90000000-0000-0000-0003-000000000001', 'H-2', current_date + 80, 100),
  ('90000000-0000-0000-0004-000000000003', '90000000-0000-0000-0003-000000000002', 'A-1', current_date + 40, 100);

-- TRZ-91: el stock por lote lo informaba el distributor_operator; ese rol y su RPC ya no existen.
select pg_temp.assert_true(to_regprocedure('public.save_distributor_stock(uuid, numeric, jsonb)') is null, 'sin RPC de stock del rol viejo');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.set_expiration_thresholds(integer, integer, integer)', 'EXECUTE'), 'anon sin ejecución (thresholds)');

insert into public.distributor_product_stocks(id, company_id, distributor_id, product_id, current_stock, daily_consumption) values
  ('90000000-0000-0000-0005-000000000001', '90000000-0000-0000-0001-000000000001', '90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0003-000000000001', 120, 10);
insert into public.distributor_batch_stocks(company_id, distributor_id, product_id, batch_id, quantity) values
  ('90000000-0000-0000-0001-000000000001', '90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0003-000000000001', '90000000-0000-0000-0004-000000000001', 80),
  ('90000000-0000-0000-0001-000000000001', '90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0003-000000000001', '90000000-0000-0000-0004-000000000002', 40);

set local role authenticated;

-- El responsable logístico ve todo lo de su empresa; el de otra empresa, nada.
select pg_temp.as_user(1);
select pg_temp.assert_true((select count(*) = 2 from public.distributor_batch_stocks), 'el manager ve los lotes de su empresa');
select pg_temp.assert_true((select count(*) = 1 from public.distributor_product_stocks), 'el manager ve el stock de su empresa');
select pg_temp.as_user(6);
select pg_temp.assert_true((select count(*) = 0 from public.distributor_batch_stocks), 'otra empresa no ve los lotes');

-- Choferes y depósito no ven ni escriben el stock de distribuidoras.
select pg_temp.as_user(2);
select pg_temp.assert_true((select count(*) = 0 from public.distributor_batch_stocks), 'el chofer no ve los lotes');
select pg_temp.assert_true((select count(*) = 0 from public.distributor_product_stocks), 'el chofer no ve el stock');
select pg_temp.as_user(4);
select pg_temp.assert_true((select count(*) = 0 from public.distributor_batch_stocks), 'depósito no ve los lotes');
select pg_temp.expect_failure($$insert into public.distributor_batch_stocks (company_id, distributor_id, product_id, batch_id, quantity)
  values ('90000000-0000-0000-0001-000000000001', '90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0003-000000000002', '90000000-0000-0000-0004-000000000003', 1)$$, '42501');
select pg_temp.as_user(1);
update public.distributor_product_stocks set current_stock = 999;
reset role;
select pg_temp.assert_true(
  (select bool_and(current_stock <> 999) from public.distributor_product_stocks where company_id = '90000000-0000-0000-0001-000000000001'),
  'nadie edita el total directamente');
set local role authenticated;

-- ---------- Niveles de vencimiento ----------
select pg_temp.as_user(2);
select pg_temp.assert_true(
  (select critical_days = 30 and caution_days = 60 and upcoming_days = 90 from public.get_expiration_thresholds()),
  'los niveles por defecto son 30, 60 y 90');
select pg_temp.expect_failure('select public.set_expiration_thresholds(10, 20, 30)', '42501');

select pg_temp.as_user(1);
select pg_temp.expect_failure('select public.set_expiration_thresholds(0, 20, 30)', 'P3901');
select pg_temp.expect_failure('select public.set_expiration_thresholds(20, 20, 30)', 'P3901');
select pg_temp.expect_failure('select public.set_expiration_thresholds(10, 40, 30)', 'P3901');
select pg_temp.expect_failure('select public.set_expiration_thresholds(10, 20, 400)', 'P3901');
select public.set_expiration_thresholds(15, 45, 120);
select pg_temp.assert_true(
  (select critical_days = 15 and caution_days = 45 and upcoming_days = 120 from public.get_expiration_thresholds()),
  'el manager cambia los niveles de su empresa');

select pg_temp.as_user(6);
select pg_temp.assert_true(
  (select critical_days = 30 from public.get_expiration_thresholds()),
  'los niveles de otra empresa no cambian');

reset role;
rollback;
