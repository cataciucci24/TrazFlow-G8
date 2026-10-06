-- Prueba de integración de US12: unidad de medida base por producto.
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

-- La unidad es obligatoria.
do $$
begin
  insert into products (company_id, sku, name)
  values ('2c000000-0000-0000-0000-000000000001', 'SKU-US12-SIN', 'Producto sin unidad');
  raise exception 'US12 test failed: se aceptó un producto sin unidad';
exception when not_null_violation then
  null;
end;
$$;

-- Una unidad fuera de la lista debe ser rechazada.
do $$
begin
  insert into products (company_id, sku, name, unit_of_measure)
  values ('2c000000-0000-0000-0000-000000000001', 'SKU-US12-LIT', 'Producto en litros', 'litros');
  raise exception 'US12 test failed: se aceptó una unidad inválida';
exception when check_violation then
  null;
end;
$$;

insert into products (id, company_id, sku, name, unit_of_measure)
values ('4c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'SKU-US12', 'Producto US12', 'kilogramos');

-- Pallets y stock de distribuidoras ya no guardan unidad: la toman del producto.
select pg_temp.assert_true(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('pallets', 'distributor_product_stocks', 'distributor_batch_stocks')
      and column_name = 'unit_of_measure'
  ),
  'pallets y stock de distribuidoras no deben tener columna de unidad'
);

-- El stock admite decimales (kilogramos).
insert into distributor_product_stocks (company_id, distributor_id, product_id, current_stock, daily_consumption)
values ('2c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', '4c000000-0000-0000-0000-000000000001', 12.5, 5);

select pg_temp.assert_true(
  (
    select stock.current_stock = 12.5 and product.unit_of_measure = 'kilogramos'
    from distributor_product_stocks stock
    join products product on product.id = stock.product_id
    where stock.product_id = '4c000000-0000-0000-0000-000000000001'
  ),
  'el stock debe admitir decimales y leer la unidad del producto'
);

rollback;
