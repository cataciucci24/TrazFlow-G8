-- Prueba de integración de US12 (paso 1): unidad de medida del stock de distribuidoras.
-- Ejecutar sobre una base local migrada.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'US12 test failed: %', message; end if;
end;
$$;

insert into companies (id, name)
values ('2c000000-0000-0000-0000-000000000001', 'US12 Company');

insert into distributors (id, company_id, name)
values ('3c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'Distribuidora US12');

insert into products (id, company_id, sku, name)
values ('4c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'SKU-US12', 'Producto US12');

-- Sin indicar unidad, la fila queda en "unidades" (compatibilidad con US8).
insert into distributor_product_stocks (company_id, distributor_id, product_id, current_stock, daily_consumption)
values ('2c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', '4c000000-0000-0000-0000-000000000001', 50, 5);

select pg_temp.assert_true(
  (select unit_of_measure = 'unidades' from distributor_product_stocks where product_id = '4c000000-0000-0000-0000-000000000001'),
  'la unidad por defecto debe ser unidades'
);

-- El stock admite decimales (kilogramos).
update distributor_product_stocks
set current_stock = 12.5, unit_of_measure = 'kilogramos'
where product_id = '4c000000-0000-0000-0000-000000000001';

select pg_temp.assert_true(
  (select current_stock = 12.5 and unit_of_measure = 'kilogramos' from distributor_product_stocks where product_id = '4c000000-0000-0000-0000-000000000001'),
  'el stock debe admitir decimales con unidad kilogramos'
);

-- Una unidad fuera de la lista debe ser rechazada.
do $$
begin
  update distributor_product_stocks set unit_of_measure = 'litros'
  where product_id = '4c000000-0000-0000-0000-000000000001';
  raise exception 'US12 test failed: se aceptó una unidad inválida';
exception when check_violation then
  null;
end;
$$;

rollback;
