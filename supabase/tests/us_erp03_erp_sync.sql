-- US-ERP-03: sincronización de maestros y órdenes desde el ERP.
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'US-ERP-03: %', message; end if;
end;
$$;

-- Corre una sincronización completa como el usuario de la sesión y devuelve el run cerrado.
create or replace function pg_temp.sync(p_company uuid, p_products jsonb, p_lots jsonb, p_stock jsonb, p_orders jsonb)
returns public.erp_sync_runs language plpgsql as $$
declare
  run_id uuid := public.erp_sync_start(p_company, auth.uid(), 'mock');
begin
  perform public.erp_sync_apply_products(run_id, p_products);
  perform public.erp_sync_apply_lots(run_id, p_lots);
  perform public.erp_sync_apply_stock(run_id, p_stock);
  perform public.erp_sync_apply_orders(run_id, p_orders);
  return public.erp_sync_finish(run_id, null);
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
$$;

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'erp-manager-a@test.local'),
  ('e1000000-0000-0000-0000-000000000002', 'erp-operator-a@test.local'),
  ('e1000000-0000-0000-0000-000000000003', 'erp-manager-b@test.local');
insert into companies (id, name) values
  ('e2000000-0000-0000-0000-000000000001', 'ERP Company A'),
  ('e2000000-0000-0000-0000-000000000002', 'ERP Company B');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'Manager A', 'erp-manager-a@test.local', 'logistics_manager'),
  ('e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'Operator A', 'erp-operator-a@test.local', 'warehouse_operator'),
  ('e1000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000002', 'Manager B', 'erp-manager-b@test.local', 'logistics_manager');
-- Producto manual con el mismo SKU que uno del ERP: no se debe fusionar.
insert into products (company_id, sku, name, unit_of_measure) values
  ('e2000000-0000-0000-0000-000000000001', 'MANUAL-SKU', 'Producto manual', 'cajas');

-- La empresa del lote la pone el trigger, aunque el cliente no la mande.
select pg_temp.assert_true(
  (select count(*) from batches where company_id is null) = 0,
  'todos los lotes deben tener empresa (backfill)'
);

select set_config('test.products', $json$[
  {"externalId":"ACE-500","sku":"ACE-500","name":"Aceite","uom":"Caja","unit":"cajas","active":true},
  {"externalId":"QSO","sku":"QSO","name":"Queso","uom":"Kg","unit":"kilogramos","active":true},
  {"externalId":"SAL","sku":"SAL","name":"Sal","uom":"Unidad","unit":"unidades","active":false},
  {"externalId":"DUP-SKU","sku":"MANUAL-SKU","name":"Choca con manual","uom":"Caja","unit":"cajas","active":true},
  {"externalId":"RARO","sku":"RARO","name":"Unidad rara","uom":"Bolsa","unit":null,"active":true},
  {"externalId":"ACE-500","sku":"ACE-500","name":"Repetido","uom":"Caja","unit":"cajas","active":true}
]$json$, true);
select set_config('test.lots', $json$[
  {"externalId":"L-1","productExternalId":"ACE-500","lotNumber":"L-1","expirationDate":"2027-03-31","active":true},
  {"externalId":"L-2","productExternalId":"ACE-500","lotNumber":"L-2","expirationDate":null,"active":true},
  {"externalId":"Q-1","productExternalId":"QSO","lotNumber":"Q-1","expirationDate":"2026-12-03","active":true},
  {"externalId":"HUERFANO","productExternalId":"NO-EXISTE","lotNumber":"H","expirationDate":null,"active":true},
  {"externalId":"FECHA-MALA","productExternalId":"QSO","lotNumber":"FM","expirationDate":"31/12/2026","active":true}
]$json$, true);
select set_config('test.stock', $json$[
  {"productExternalId":"ACE-500","lotExternalId":"L-1","warehouseExternalId":"Central","quantity":120,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"ACE-500","lotExternalId":"L-2","warehouseExternalId":"Central","quantity":80,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"QSO","lotExternalId":"Q-1","warehouseExternalId":"Central","quantity":356.5,"uom":"Kg","unit":"kilogramos"},
  {"productExternalId":"ACE-500","lotExternalId":"L-1","warehouseExternalId":"Sin vincular","quantity":5,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"ACE-500","lotExternalId":"L-2","warehouseExternalId":"Norte","quantity":2.5,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"QSO","lotExternalId":"L-1","warehouseExternalId":"Norte","quantity":1,"uom":"Kg","unit":"kilogramos"},
  {"productExternalId":"ACE-500","lotExternalId":null,"warehouseExternalId":"Central","quantity":3,"uom":"Caja","unit":"cajas"}
]$json$, true);
select set_config('test.orders', $json$[
  {"externalId":"SO-1","status":"pending","customer":{"externalId":"CUST-N","name":"Distribuidora Norte"},"scheduledDate":"2026-10-20",
   "lines":[{"externalId":"SO-1-1","productExternalId":"ACE-500","quantity":65,"uom":"Caja","unit":"cajas","warehouseExternalId":"Central"}]},
  {"externalId":"SO-2","status":"partially_delivered","customer":{"externalId":"CUST-N","name":"Distribuidora Norte"},"scheduledDate":null,
   "lines":[{"externalId":"SO-2-1","productExternalId":"QSO","quantity":48.25,"uom":"Kg","unit":"kilogramos","warehouseExternalId":null}]},
  {"externalId":"SO-3","status":"delivered","customer":{"externalId":"CUST-S","name":"Sur"},"scheduledDate":"2026-10-05"},
  {"externalId":"SO-4","status":"pending","customer":null,"scheduledDate":"2026-10-21"}
]$json$, true);

/* ---------- Autorización ---------- */

set local role authenticated;

select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_sync_start(uuid, uuid, text)', 'execute'), 'anon no debe poder iniciar');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_sync_apply_stock(uuid, jsonb)', 'execute'), 'anon no debe poder aplicar stock');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.erp_sync_lock_run(uuid)', 'execute'), 'los helpers no se exponen');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.erp_sync_runs', 'select'), 'anon no lee erp_sync_runs');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.erp_warehouse_mappings', 'select'), 'anon no lee correspondencias');

do $$
begin
  perform pg_temp.as_user('e1000000-0000-0000-0000-000000000002');
  begin
    perform public.erp_sync_start('e2000000-0000-0000-0000-000000000001', auth.uid(), 'mock');
    raise exception 'US-ERP-03: un operador de depósito pudo iniciar la sincronización';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user('e1000000-0000-0000-0000-000000000003');
  begin
    perform public.erp_sync_start('e2000000-0000-0000-0000-000000000001', auth.uid(), 'mock');
    raise exception 'US-ERP-03: logística de otra empresa pudo sincronizar la empresa A';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user('e1000000-0000-0000-0000-000000000001');
  begin
    perform public.erp_sync_start('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'mock');
    raise exception 'US-ERP-03: se aceptó un actor distinto del usuario de la sesión';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.erp_sync_runs (company_id, triggered_by, provider)
    values ('e2000000-0000-0000-0000-000000000001', auth.uid(), 'mock');
    raise exception 'US-ERP-03: authenticated pudo escribir erp_sync_runs';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.products (company_id, sku, name, unit_of_measure, external_id, source_system)
    values ('e2000000-0000-0000-0000-000000000001', 'X', 'X', 'cajas', 'X', 'erp');
    raise exception 'US-ERP-03: la API pudo crear un producto marcado como del ERP';
  exception when insufficient_privilege then null;
  end;
end;
$$;

/* ---------- Primera sincronización: registros parciales ---------- */

-- Correspondencia de depósitos: Central y Norte sí, "Sin vincular" no. Desde TRZ-101 los vínculos los crea
-- erp_sync_apply_warehouses (trz101_erp_warehouses.sql); acá se cargan como postgres, como los de antes de TRZ-101,
-- para probar el stock sin la etapa de depósitos.
reset role;
insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values
  ('e2000000-0000-0000-0000-000000000001', 'Central', 'DEP-01', 'e1000000-0000-0000-0000-000000000001'),
  ('e2000000-0000-0000-0000-000000000001', 'Norte', 'DEP-01', 'e1000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.as_user('e1000000-0000-0000-0000-000000000001');

do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('e2000000-0000-0000-0000-000000000001',
    current_setting('test.products')::jsonb, current_setting('test.lots')::jsonb,
    current_setting('test.stock')::jsonb, current_setting('test.orders')::jsonb);

  perform pg_temp.assert_true(run.status = 'partial', 'con registros fallidos el run debe quedar partial, quedó ' || run.status);
  perform pg_temp.assert_true(run.triggered_by = auth.uid() and run.finished_at is not null, 'run auditado con actor y fin');
  perform pg_temp.assert_true(run.counters->'products' = '{"received":6,"created":3,"updated":0,"unchanged":0,"failed":3}', 'contadores de productos: ' || (run.counters->'products')::text);
  perform pg_temp.assert_true(run.counters->'lots' = '{"received":5,"created":3,"updated":0,"unchanged":0,"failed":2}', 'contadores de lotes: ' || (run.counters->'lots')::text);
  perform pg_temp.assert_true((run.counters->'stock'->>'created')::int = 3 and (run.counters->'stock'->>'failed')::int = 4, 'contadores de stock: ' || (run.counters->'stock')::text);
  perform pg_temp.assert_true((run.counters->'orders'->>'created')::int = 2 and (run.counters->'orders'->>'skipped')::int = 1
    and (run.counters->'orders'->>'failed')::int = 1 and (run.counters->'orders'->>'customers_created')::int = 1, 'contadores de órdenes: ' || (run.counters->'orders')::text);
  perform pg_temp.assert_true(jsonb_array_length(run.errors) = 10, 'cada registro fallido queda auditado: ' || run.errors::text);
  perform pg_temp.assert_true(run.errors @> '[{"entity":"products","external_id":"DUP-SKU"}]', 'colisión de SKU auditada');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'DUP-SKU' and e->>'message' like '%No se fusionan productos por SKU%'), 'mensaje de colisión de SKU legible');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'ACE-500' and e->>'message' like '%repetido%'), 'externalId repetido en la respuesta auditado');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'L-1@Sin vincular' and e->>'message' like '%no está en su lista de depósitos%'), 'depósito sin correspondencia auditado');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'L-2@Norte' and e->>'message' like '%no es entera%'), 'decimal en cajas auditado');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'L-1@Norte' and e->>'message' like '%no corresponde al producto%'), 'lote de otro producto auditado');
end;
$$;

select pg_temp.assert_true(
  (select count(*) from products where external_id = 'ACE-500' and source_system = 'erp' and name = 'Aceite' and synced_at is not null) = 1,
  'el producto se crea una vez, con el primer registro'
);
select pg_temp.assert_true(
  (select name from products where sku = 'MANUAL-SKU') = 'Producto manual',
  'el producto manual con el mismo SKU no se toca'
);
select pg_temp.assert_true(
  (select external_active from products where external_id = 'SAL') = false,
  'un producto inactivo en el ERP se importa marcado, sin borrarse'
);
select pg_temp.assert_true(
  (select company_id from batches where external_id = 'L-1') = 'e2000000-0000-0000-0000-000000000001'
  and (select quantity from batches where external_id = 'L-1') = 0,
  'el lote del ERP queda en la empresa con cantidad 0'
);
-- TRZ-100: los saldos van a erp_stock_balances; la sincronización ya no crea pallets.
select pg_temp.assert_true(
  (select count(*) from pallets where company_id = 'e2000000-0000-0000-0000-000000000001') = 0,
  'la sincronización no crea pallets'
);
select pg_temp.assert_true(
  (select count(*) from erp_stock_balances where warehouse_code = 'DEP-01' and external_warehouse_id = 'Central') = 3,
  'los saldos importados quedan en el depósito vinculado'
);
select pg_temp.assert_true(
  (select balance.quantity from erp_stock_balances balance join batches batch on batch.id = balance.batch_id
   where batch.external_id = 'Q-1') = 356.5,
  'la cantidad decimal en kilogramos se conserva'
);
select pg_temp.assert_true(
  (select count(*) from dispatch_order_lines) = 2
  and (select quantity from dispatch_order_lines where external_id = 'SO-2-1') = 48.25,
  'las órdenes abiertas se importan con sus líneas'
);
select pg_temp.assert_true(
  (select estimated_dispatch_date from dispatch_orders where external_id = 'SO-2') = (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  'sin fecha prevista se usa la fecha de la sincronización'
);
select pg_temp.assert_true(
  (select count(*) from dispatch_orders where source_system = 'erp' and status = 'draft' and created_by = auth.uid()) = 2,
  'las órdenes abiertas entran en borrador creadas por quien sincroniza'
);
select pg_temp.assert_true(
  (select count(*) from distributors where external_id = 'CUST-N') = 1,
  'el cliente del ERP se crea una sola vez como distribuidora'
);

/* ---------- Segunda sincronización: idempotencia ---------- */

do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('e2000000-0000-0000-0000-000000000001',
    current_setting('test.products')::jsonb, current_setting('test.lots')::jsonb,
    current_setting('test.stock')::jsonb, current_setting('test.orders')::jsonb);
  perform pg_temp.assert_true((run.counters->'products'->>'created')::int = 0 and (run.counters->'products'->>'unchanged')::int = 3, 'segunda vez: productos sin cambios');
  perform pg_temp.assert_true((run.counters->'lots'->>'created')::int = 0 and (run.counters->'lots'->>'unchanged')::int = 3, 'segunda vez: lotes sin cambios');
  perform pg_temp.assert_true((run.counters->'stock'->>'created')::int = 0 and (run.counters->'stock'->>'unchanged')::int = 3, 'segunda vez: saldos sin cambios');
  perform pg_temp.assert_true((run.counters->'orders'->>'created')::int = 0 and (run.counters->'orders'->>'unchanged')::int = 2, 'segunda vez: órdenes sin cambios');
end;
$$;

select pg_temp.assert_true((select count(*) from products where source_system = 'erp') = 3, 'no se duplican productos');
select pg_temp.assert_true((select count(*) from batches where source_system = 'erp') = 3, 'no se duplican lotes');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 3, 'no se duplican saldos');
select pg_temp.assert_true((select count(*) from pallets) = (select count(*) from pallets where company_id <> 'e2000000-0000-0000-0000-000000000001'), 'la segunda sincronización tampoco crea pallets');
select pg_temp.assert_true((select count(*) from dispatch_orders where source_system = 'erp') = 2, 'no se duplican órdenes');
select pg_temp.assert_true((select count(*) from distributors where source_system = 'erp') = 1, 'no se duplican clientes');

/* ---------- La re-sincronización no pisa el progreso local ---------- */

-- TRZ-100: logística arma un pallet físico de 50 cajas contra L-1 (saldo 120).
insert into pallets (company_id, batch_id, quantity, current_location)
select 'e2000000-0000-0000-0000-000000000001', id, 50, 'Depósito' from batches where external_id = 'L-1';

reset role;
-- SO-1 avanzó a validación; el pallet de L-1 tiene un evento de trazabilidad. Además hay un pallet heredado
-- de la época en que un saldo era un pallet ('stock:Q-1@Central'), todavía en depósito.
update dispatch_orders set status = 'validating' where external_id = 'SO-1';
insert into traceability_events (company_id, pallet_id, event_type, user_id, details)
select company_id, id, 'qr_scan', 'e1000000-0000-0000-0000-000000000001', '{}'::jsonb
from pallets where company_id = 'e2000000-0000-0000-0000-000000000001' and source_system = 'trazflow';
insert into pallets (company_id, batch_id, quantity, current_location, external_id, source_system, synced_at, status)
select 'e2000000-0000-0000-0000-000000000001', id, 300, 'DEP-01', 'stock:Q-1@Central', 'erp', now(), 'in_warehouse'
from batches where external_id = 'Q-1';
set local role authenticated;

do $$
declare
  run public.erp_sync_runs;
  qr_before text := (select qr_code from public.pallets where external_id = 'stock:Q-1@Central');
begin
  run := pg_temp.sync('e2000000-0000-0000-0000-000000000001',
    '[{"externalId":"ACE-500","sku":"ACE-500","name":"Aceite 500","uom":"Caja","unit":"cajas","active":true}]',
    '[{"externalId":"L-1","productExternalId":"ACE-500","lotNumber":"L-1","expirationDate":"2027-04-30","active":true}]',
    -- L-1 y L-2 cambian de cantidad, Q-1 también; no llega ningún saldo nuevo.
    '[{"productExternalId":"ACE-500","lotExternalId":"L-1","warehouseExternalId":"Central","quantity":10,"uom":"Caja","unit":"cajas"},
      {"productExternalId":"ACE-500","lotExternalId":"L-2","warehouseExternalId":"Central","quantity":20,"uom":"Caja","unit":"cajas"},
      {"productExternalId":"QSO","lotExternalId":"Q-1","warehouseExternalId":"Central","quantity":300,"uom":"Kg","unit":"kilogramos"}]',
    '[{"externalId":"SO-1","status":"pending","customer":{"externalId":"CUST-N","name":"Distribuidora Norte SA"},"scheduledDate":"2026-11-01",
       "lines":[{"externalId":"SO-1-1","productExternalId":"ACE-500","quantity":99,"uom":"Caja","unit":"cajas","warehouseExternalId":"Central"}]},
      {"externalId":"SO-2","status":"pending","customer":{"externalId":"CUST-N","name":"Distribuidora Norte SA"},"scheduledDate":"2026-11-02",
       "lines":[{"externalId":"SO-2-1","productExternalId":"QSO","quantity":48.25,"uom":"Kg","unit":"kilogramos","warehouseExternalId":null}]}]');

  perform pg_temp.assert_true(run.status = 'success', 'la tercera sincronización no tiene errores: ' || run.errors::text);
  -- TRZ-100: los saldos se actualizan siempre; ya no hay pallets "protegidos".
  perform pg_temp.assert_true((run.counters->'stock'->>'updated')::int = 3 and run.counters->'stock'->'protected' is null, 'saldos actualizados: ' || (run.counters->'stock')::text);
  perform pg_temp.assert_true((run.counters->'orders'->>'protected')::int = 1 and (run.counters->'orders'->>'updated')::int = 1, 'órdenes protegidas/actualizadas: ' || (run.counters->'orders')::text);
  perform pg_temp.assert_true((select qr_code from public.pallets where external_id = 'stock:Q-1@Central') = qr_before, 'la re-sincronización no cambia el QR');
end;
$$;

select pg_temp.assert_true((select status from dispatch_orders where external_id = 'SO-1') = 'validating', 'una orden en validación no vuelve a borrador');
select pg_temp.assert_true((select estimated_dispatch_date from dispatch_orders where external_id = 'SO-1') = '2026-10-20', 'una orden en validación conserva su fecha');
select pg_temp.assert_true((select estimated_dispatch_date from dispatch_orders where external_id = 'SO-2') = '2026-11-02', 'una orden en borrador se actualiza');
select pg_temp.assert_true((select quantity from pallets where source_system = 'trazflow' and company_id = 'e2000000-0000-0000-0000-000000000001') = 50,
  'la sincronización no toca los pallets físicos, aunque el saldo baje por debajo de lo armado');
select pg_temp.assert_true((select balance.quantity from erp_stock_balances balance join batches batch on batch.id = balance.batch_id where batch.external_id = 'L-1') = 10,
  'el saldo de L-1 baja a 10');
select pg_temp.assert_true((select quantity from pallets where external_id = 'stock:Q-1@Central') = 300, 'un pallet heredado conserva su cantidad');
select pg_temp.assert_true((select status from pallets where external_id = 'stock:Q-1@Central') = 'in_warehouse', 'un pallet heredado conserva su estado');
select pg_temp.assert_true((select count(*) from traceability_events where pallet_id = (select id from pallets where source_system = 'trazflow' and company_id = 'e2000000-0000-0000-0000-000000000001')) = 1, 'la historia del pallet se conserva');
select pg_temp.assert_true((select quantity from dispatch_order_lines where external_id = 'SO-1-1') = 65, 'las líneas de una orden en validación no se tocan');
select pg_temp.assert_true((select expiration_date from batches where external_id = 'L-1') = '2027-04-30', 'el vencimiento del lote viene del ERP');
select pg_temp.assert_true((select name from distributors where external_id = 'CUST-N') = 'Distribuidora Norte SA', 'el nombre del cliente se actualiza por externalId');

/* ---------- Saldos que desaparecen: no se borra nada ---------- */

do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('e2000000-0000-0000-0000-000000000001', '[]', '[]',
    '[{"productExternalId":"QSO","lotExternalId":"Q-1","warehouseExternalId":"Central","quantity":0,"uom":"Kg","unit":"kilogramos"}]', '[]');
  perform pg_temp.assert_true((run.counters->'stock'->>'absent')::int = 2 and (run.counters->'stock'->>'updated')::int = 1,
    'saldos ausentes y en 0: ' || (run.counters->'stock')::text);
end;
$$;
select pg_temp.assert_true((select count(*) from erp_stock_balances where company_id = 'e2000000-0000-0000-0000-000000000001') = 3
  and (select count(*) from erp_stock_balances where company_id = 'e2000000-0000-0000-0000-000000000001' and quantity = 0) = 3,
  'los saldos ausentes o en 0 quedan en 0, no se borran');
select pg_temp.assert_true((select quantity from pallets where external_id = 'stock:Q-1@Central') = 300, 'un saldo en 0 no modifica el pallet heredado');
select pg_temp.assert_true((select count(*) from products where source_system = 'erp') = 3, 'los productos ausentes no se borran');
select pg_temp.assert_true((select count(*) from dispatch_orders where source_system = 'erp') = 2, 'las órdenes ausentes no se borran');

/* ---------- Los datos del ERP no se editan ni borran desde la API ---------- */

do $$
begin
  begin
    update public.products set name = 'Editado' where external_id = 'ACE-500';
    raise exception 'US-ERP-03: se pudo editar un producto del ERP';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.pallets set quantity = 1 where external_id = 'stock:Q-1@Central';
    raise exception 'US-ERP-03: se pudo editar la cantidad de un pallet del ERP';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.pallets where external_id = 'stock:Q-1@Central';
    raise exception 'US-ERP-03: se pudo borrar un pallet del ERP';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.pallets set qr_code = 'MANUAL' where external_id = 'stock:Q-1@Central';
    raise exception 'US-ERP-03: se pudo cambiar el QR de un pallet importado';
  exception when insufficient_privilege or check_violation then null;
  end;
  -- El flujo operativo sigue funcionando sobre pallets importados.
  update public.pallets set status = 'assigned' where external_id = 'stock:Q-1@Central';
  update public.pallets set status = 'in_warehouse' where external_id = 'stock:Q-1@Central';
  -- Y los datos manuales se siguen editando como antes.
  update public.products set name = 'Producto manual editado' where sku = 'MANUAL-SKU';
end;
$$;

/* ---------- Concurrencia y ejecución cerrada ---------- */

do $$
declare
  run_id uuid := public.erp_sync_start('e2000000-0000-0000-0000-000000000001', auth.uid(), 'mock');
  finished public.erp_sync_runs;
begin
  begin
    perform public.erp_sync_start('e2000000-0000-0000-0000-000000000001', auth.uid(), 'mock');
    raise exception 'US-ERP-03: se abrieron dos sincronizaciones a la vez';
  exception when lock_not_available then null;
  end;
  finished := public.erp_sync_finish(run_id, 'El ERP no respondió a tiempo (mock).');
  perform pg_temp.assert_true(finished.status = 'failed' and finished.error_message like '%no respondió%', 'una falla del ERP queda auditada como failed');
  begin
    perform public.erp_sync_apply_products(run_id, '[]');
    raise exception 'US-ERP-03: se aplicaron datos a una ejecución cerrada';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

/* ---------- RLS por empresa y rol ---------- */

select pg_temp.assert_true((select count(*) from erp_sync_runs) = 5, 'logística A ve sus ejecuciones');
select pg_temp.assert_true((select count(*) from erp_warehouse_mappings) = 2, 'logística A ve sus depósitos vinculados');

select pg_temp.as_user('e1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((select count(*) from erp_sync_runs) = 0, 'el operador de depósito no ve las ejecuciones');
select pg_temp.assert_true((select count(*) from erp_warehouse_mappings) = 0, 'el operador de depósito no ve los depósitos vinculados');
select pg_temp.assert_true((select count(*) from pallets where source_system = 'erp') = 1, 'el operador ve los pallets heredados de su empresa');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 3, 'el operador ve los saldos de su empresa');
do $$
begin
  insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code) values ('e2000000-0000-0000-0000-000000000001', 'Otro', 'DEP-01');
  raise exception 'US-ERP-03: el operador pudo vincular un depósito';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('e1000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select count(*) from erp_sync_runs) = 0, 'otra empresa no ve las ejecuciones de A');
select pg_temp.assert_true((select count(*) from erp_warehouse_mappings) = 0, 'otra empresa no ve los depósitos de A');
select pg_temp.assert_true((select count(*) from products where source_system = 'erp') = 0, 'otra empresa no ve productos de A');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 0, 'otra empresa no ve saldos de A');

-- El mismo externalId en otra empresa es otro registro.
reset role;
insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by)
  values ('e2000000-0000-0000-0000-000000000002', 'Central', 'DEP-01', 'e1000000-0000-0000-0000-000000000003');
set local role authenticated;
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('e2000000-0000-0000-0000-000000000002',
    '[{"externalId":"ACE-500","sku":"ACE-500","name":"Aceite B","uom":"Caja","unit":"cajas","active":true}]',
    '[{"externalId":"L-1","productExternalId":"ACE-500","lotNumber":"L-1","expirationDate":null,"active":true}]',
    '[{"productExternalId":"ACE-500","lotExternalId":"L-1","warehouseExternalId":"Central","quantity":7,"uom":"Caja","unit":"cajas"}]',
    '[]');
  perform pg_temp.assert_true(run.status = 'success', 'empresa B sincroniza sus propios datos: ' || run.errors::text);
end;
$$;
select pg_temp.assert_true((select name from products where external_id = 'ACE-500') = 'Aceite B', 'empresa B ve solo su producto');

reset role;
-- Solo las empresas del test: en una base local con los datos de la demo también hay un ACE-500.
select pg_temp.assert_true((select count(*) from products where external_id = 'ACE-500'
  and company_id in ('e2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002')) = 2,
  'el mismo externalId convive en dos empresas');
select pg_temp.assert_true((select name from products where external_id = 'ACE-500' and company_id = 'e2000000-0000-0000-0000-000000000001') = 'Aceite 500', 'empresa B no pisa a empresa A');

rollback;
