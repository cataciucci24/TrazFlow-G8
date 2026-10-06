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

-- Empresas A y B. Usuarios: 1 manager A · 2 distribuidor A (Norte) · 3 distribuidor A (Sur)
-- · 4 depósito A · 5 distribuidor A sin distribuidora · 6 manager B
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
    else 'distributor_operator'::public.user_role end
from generate_series(1, 6) n;
insert into public.distributors(id, company_id, name) values
  ('90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0001-000000000001', 'Norte'),
  ('90000000-0000-0000-0002-000000000002', '90000000-0000-0000-0001-000000000001', 'Sur');
insert into public.distributor_users(distributor_id, user_id) values
  ('90000000-0000-0000-0002-000000000001', pg_temp.uid(2)),
  ('90000000-0000-0000-0002-000000000002', pg_temp.uid(3));
insert into public.products(id, company_id, sku, name) values
  ('90000000-0000-0000-0003-000000000001', '90000000-0000-0000-0001-000000000001', 'TRZ90-HAR', 'Harina'),
  ('90000000-0000-0000-0003-000000000002', '90000000-0000-0000-0001-000000000001', 'TRZ90-ACE', 'Aceite'),
  ('90000000-0000-0000-0003-000000000003', '90000000-0000-0000-0001-000000000002', 'TRZ90-B', 'Producto B');
insert into public.batches(id, product_id, batch_number, expiration_date, quantity) values
  ('90000000-0000-0000-0004-000000000001', '90000000-0000-0000-0003-000000000001', 'H-1', current_date + 20, 100),
  ('90000000-0000-0000-0004-000000000002', '90000000-0000-0000-0003-000000000001', 'H-2', current_date + 80, 100),
  ('90000000-0000-0000-0004-000000000003', '90000000-0000-0000-0003-000000000002', 'A-1', current_date + 40, 100);

select pg_temp.assert_true(not has_function_privilege('anon', 'public.save_distributor_stock(uuid, text, numeric, jsonb)', 'EXECUTE'), 'anon sin ejecución (save)');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.set_expiration_thresholds(integer, integer, integer)', 'EXECUTE'), 'anon sin ejecución (thresholds)');

set local role authenticated;

-- ---------- Guardar stock por lote ----------
-- Solo un operador de distribuidora.
select pg_temp.as_user(1);
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[]')$$, '42501');
select pg_temp.as_user(4);
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[]')$$, '42501');
select pg_temp.as_user(5);
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[]')$$, 'P3902');

select pg_temp.as_user(2);
-- Validaciones.
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000003', 'cajas', 10, '[]')$$, 'P3903');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'litros', 10, '[]')$$, 'P3904');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 0, '[]')$$, 'P3905');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '{}')$$, 'P3906');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[{"batch_id": "no-uuid", "quantity": 5}]')$$, 'P3906');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[{"batch_id": "90000000-0000-0000-0004-000000000001", "quantity": 0}]')$$, 'P3906');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[{"batch_id": "90000000-0000-0000-0004-000000000001", "quantity": 2.5}]')$$, 'P3906');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[{"batch_id": "90000000-0000-0000-0004-000000000003", "quantity": 5}]')$$, 'P3907');
select pg_temp.expect_failure($$select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10, '[{"batch_id": "90000000-0000-0000-0004-000000000001", "quantity": 5}, {"batch_id": "90000000-0000-0000-0004-000000000001", "quantity": 3}]')$$, 'P3908');

-- El total del producto es la suma de los lotes.
select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'cajas', 10,
  '[{"batch_id": "90000000-0000-0000-0004-000000000001", "quantity": 80}, {"batch_id": "90000000-0000-0000-0004-000000000002", "quantity": 40}]');
select pg_temp.assert_true(
  (select current_stock = 120 and daily_consumption = 10 and unit_of_measure = 'cajas' from public.distributor_product_stocks
    where distributor_id = '90000000-0000-0000-0002-000000000001' and product_id = '90000000-0000-0000-0003-000000000001'),
  'el total debe ser 80 + 40');
select pg_temp.assert_true((select count(*) = 2 from public.distributor_batch_stocks), 'el operador ve sus dos lotes');

-- Guardar de nuevo reemplaza los lotes anteriores.
select public.save_distributor_stock('90000000-0000-0000-0003-000000000001', 'kilogramos', 2.5,
  '[{"batch_id": "90000000-0000-0000-0004-000000000002", "quantity": 12.75}]');
select pg_temp.assert_true(
  (select current_stock = 12.75 and unit_of_measure = 'kilogramos' from public.distributor_product_stocks
    where distributor_id = '90000000-0000-0000-0002-000000000001'),
  'el total se recalcula y admite decimales en kilogramos');
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(batch_id = '90000000-0000-0000-0004-000000000002') from public.distributor_batch_stocks),
  'el lote que ya no se informa se borra');

-- Una lista vacía deja el producto en cero.
select public.save_distributor_stock('90000000-0000-0000-0003-000000000002', 'unidades', 4, '[]');
select pg_temp.assert_true(
  (select current_stock = 0 from public.distributor_product_stocks where product_id = '90000000-0000-0000-0003-000000000002'),
  'sin lotes el stock es cero');

-- Las escrituras directas quedan cerradas.
update public.distributor_product_stocks set current_stock = 999;
select pg_temp.assert_true(
  (select bool_and(current_stock <> 999) from public.distributor_product_stocks),
  'el operador no puede editar el total directamente');
select pg_temp.expect_failure($$insert into public.distributor_batch_stocks (company_id, distributor_id, product_id, batch_id, quantity)
  values ('90000000-0000-0000-0001-000000000001', '90000000-0000-0000-0002-000000000001', '90000000-0000-0000-0003-000000000002', '90000000-0000-0000-0004-000000000003', 1)$$, '42501');

-- Otro operador no ve el stock de Norte.
select pg_temp.as_user(3);
select pg_temp.assert_true((select count(*) = 0 from public.distributor_batch_stocks), 'Sur no ve los lotes de Norte');
select pg_temp.assert_true((select count(*) = 0 from public.distributor_product_stocks), 'Sur no ve los productos de Norte');

-- El responsable logístico ve todo lo de su empresa; el de otra empresa, nada.
select pg_temp.as_user(1);
select pg_temp.assert_true((select count(*) = 1 from public.distributor_batch_stocks), 'el manager ve los lotes de su empresa');
select pg_temp.as_user(6);
select pg_temp.assert_true((select count(*) = 0 from public.distributor_batch_stocks), 'otra empresa no ve los lotes');

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
