-- Prueba de integración de US8. Ejecutar sobre una base local migrada.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'US8 test failed: %', message; end if;
end;
$$;

insert into auth.users (id, email)
values
  ('18000000-0000-0000-0000-000000000001', 'manager-us8@test.local'),
  ('18000000-0000-0000-0000-000000000002', 'distributor-us8@test.local');

insert into companies (id, name)
values ('28000000-0000-0000-0000-000000000001', 'US8 Company');

insert into users (id, company_id, name, email, role)
values
  ('18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'Manager US8', 'manager-us8@test.local', 'logistics_manager'),
  ('18000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000001', 'Distributor US8', 'distributor-us8@test.local', 'distributor_operator');

insert into distributors (id, company_id, name)
values ('38000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'Distribuidora crítica'), ('38000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000001', 'Distribuidora precaución');

insert into distributor_users (distributor_id, user_id)
values ('38000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000002');

insert into products (id, company_id, sku, name)
values ('48000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'SKU-US8-CRIT', 'Producto crítico'), ('48000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000001', 'SKU-US8-CAUT', 'Producto precaución');

-- 35 / 5 = 7 días (crítica) y 80 / 10 = 8 días (precaución).
insert into distributor_product_stocks (company_id, distributor_id, product_id, current_stock, daily_consumption)
values ('28000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-000000000001', 35, 5), ('28000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-000000000002', 80, 10);

set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000001', true);

select pg_temp.assert_true((select current_stock / daily_consumption = 7 from distributor_product_stocks where current_stock = 35), '35 / 5 debe dar 7 días');
select pg_temp.assert_true((select current_stock / daily_consumption = 8 from distributor_product_stocks where current_stock = 80), '80 / 10 debe dar 8 días');

set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000002', true);

update distributor_product_stocks
set current_stock = 30, daily_consumption = 6
where distributor_id = '38000000-0000-0000-0000-000000000001';

select pg_temp.assert_true(
  (select current_stock = 30 and daily_consumption = 6 from distributor_product_stocks where distributor_id = '38000000-0000-0000-0000-000000000001'),
  'el operador debe poder actualizar el stock de su distribuidora'
);

update distributor_product_stocks
set current_stock = 999
where distributor_id = '38000000-0000-0000-0000-000000000002';

reset role;

select pg_temp.assert_true(
  (select count(*) = 0 from distributor_product_stocks where current_stock = 999),
  'el operador no debe poder actualizar stock de otra distribuidora'
);

rollback;
