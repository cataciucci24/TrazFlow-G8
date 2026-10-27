-- TRZ-100: saldos del ERP separados de los pallets físicos, tope por saldo, estado del remito y líneas de orden.
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
--
-- Dentro de una transacción now() no avanza: para simular "el saldo se sincronizó después de ver la
-- confirmación del remito" se mueven timestamps a mano (como postgres).
--
-- CONCURRENCIA (prueba manual con dos sesiones psql; no se puede automatizar dentro de una sola transacción):
--   Preparación: una empresa con un lote del ERP con saldo 100 en DEP-01 y un usuario logistics_manager.
--   En las dos sesiones:
--     begin;
--     set local role authenticated;
--     select set_config('request.jwt.claim.sub', '<id de logística>', true),
--            set_config('request.jwt.claim.role', 'authenticated', true);
--   Sesión 1: insert into pallets (company_id, batch_id, quantity) values ('<empresa>', '<lote>', 60);
--             -> ok (toma el lock de las filas de erp_stock_balances del lote)
--   Sesión 2: insert into pallets (company_id, batch_id, quantity) values ('<empresa>', '<lote>', 60);
--             -> queda esperando el lock (select ... for update en enforce_erp_stock_cap)
--   Sesión 1: commit;
--   Sesión 2: se destraba y falla con TF100 "disponible 40": en read committed, la suma que corre después del
--             lock toma una foto nueva y ya ve el pallet de 60 de la sesión 1.
--   Sesión 2: rollback;
--   (Con 40 en la sesión 2 en vez de 60, el insert pasa: 60 + 40 = 100.)
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-100: %', message; end if;
end;
$$;

-- Ejecuta p_sql y exige que falle con p_state.
create or replace function pg_temp.assert_raises(p_sql text, p_state text, message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TRZ-100: % (no falló)', message;
exception when others then
  if sqlstate <> p_state then
    raise exception 'TRZ-100: % (esperaba %, obtuvo %: %)', message, p_state, sqlstate, sqlerrm;
  end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

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

create or replace function pg_temp.lot(p_external text) returns uuid language sql as $$
  select id from public.batches where company_id = 'a1000000-0000-0000-0000-00000000000a' and external_id = p_external;
$$;

create or replace function pg_temp.balance(p_lot text, p_warehouse text) returns public.erp_stock_balances language sql as $$
  select * from public.erp_stock_balances where batch_id = pg_temp.lot(p_lot) and external_warehouse_id = p_warehouse;
$$;

-- Disponible de un lote en DEP-01 tal como lo calcula el tope.
create or replace function pg_temp.available(p_lot text) returns numeric language sql security definer as $$
  select (select coalesce(sum(quantity), 0) from public.erp_stock_balances
          where batch_id = pg_temp.lot(p_lot) and warehouse_code = 'DEP-01')
       - (select coalesce(sum(quantity), 0) from public.erp_pallet_stock_usage('a1000000-0000-0000-0000-00000000000a', pg_temp.lot(p_lot), 'DEP-01') where counts);
$$;

create or replace function pg_temp.phase(p_pallet uuid) returns text language sql security definer as $$
  select phase from public.erp_pallet_stock_usage('a1000000-0000-0000-0000-00000000000a') where pallet_id = p_pallet;
$$;

/* ---------- Fixtures ---------- */

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'trz100-manager-a@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'trz100-warehouse-a@test.local'),
  ('a1000000-0000-0000-0000-000000000003', 'trz100-driver-a@test.local'),
  ('a1000000-0000-0000-0000-000000000004', 'trz100-manager-b@test.local');
insert into companies (id, name) values
  ('a1000000-0000-0000-0000-00000000000a', 'TRZ100 Company A'),
  ('a1000000-0000-0000-0000-00000000000b', 'TRZ100 Company B');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', 'Logística A', 'trz100-manager-a@test.local', 'logistics_manager'),
  ('a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', 'Depósito A', 'trz100-warehouse-a@test.local', 'warehouse_operator'),
  ('a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', 'Chofer A', 'trz100-driver-a@test.local', 'driver_operator'),
  ('a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-00000000000b', 'Logística B', 'trz100-manager-b@test.local', 'logistics_manager');
-- Dos depósitos del ERP vinculados al mismo depósito de TrazFlow (como en la nube).
insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values
  ('a1000000-0000-0000-0000-00000000000a', 'Central', 'DEP-01', 'a1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-00000000000a', 'Norte', 'DEP-01', 'a1000000-0000-0000-0000-000000000001');

select set_config('test.products', $json$[
  {"externalId":"ACE","sku":"ACE","name":"Aceite","uom":"Caja","unit":"cajas","active":true},
  {"externalId":"QSO","sku":"QSO","name":"Queso","uom":"Kg","unit":"kilogramos","active":true},
  {"externalId":"OFF","sku":"OFF","name":"Discontinuado","uom":"Caja","unit":"cajas","active":false}
]$json$, true);
select set_config('test.lots', $json$[
  {"externalId":"L-1","productExternalId":"ACE","lotNumber":"L-1","expirationDate":"2027-03-31","active":true},
  {"externalId":"L-2","productExternalId":"ACE","lotNumber":"L-2","expirationDate":"2027-04-15","active":true},
  {"externalId":"L-3","productExternalId":"ACE","lotNumber":"L-3","expirationDate":null,"active":true},
  {"externalId":"L-OFF","productExternalId":"ACE","lotNumber":"L-OFF","expirationDate":null,"active":false},
  {"externalId":"Q-1","productExternalId":"QSO","lotNumber":"Q-1","expirationDate":"2026-12-03","active":true},
  {"externalId":"X-1","productExternalId":"OFF","lotNumber":"X-1","expirationDate":null,"active":true}
]$json$, true);
select set_config('test.stock', $json$[
  {"productExternalId":"ACE","lotExternalId":"L-1","warehouseExternalId":"Central","quantity":120,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"ACE","lotExternalId":"L-1","warehouseExternalId":"Norte","quantity":30,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"ACE","lotExternalId":"L-2","warehouseExternalId":"Central","quantity":80,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"ACE","lotExternalId":"L-OFF","warehouseExternalId":"Central","quantity":50,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"QSO","lotExternalId":"Q-1","warehouseExternalId":"Central","quantity":356.5,"uom":"Kg","unit":"kilogramos"},
  {"productExternalId":"OFF","lotExternalId":"X-1","warehouseExternalId":"Central","quantity":10,"uom":"Caja","unit":"cajas"},
  {"productExternalId":"ACE","lotExternalId":"L-2","warehouseExternalId":"Sin vincular","quantity":5,"uom":"Caja","unit":"cajas"}
]$json$, true);
select set_config('test.orders', $json$[
  {"externalId":"SO-1","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":"2026-10-20",
   "lines":[{"externalId":"SO-1-1","productExternalId":"ACE","quantity":65,"uom":"Caja","unit":"cajas","warehouseExternalId":"Central"},
            {"externalId":"SO-1-2","productExternalId":"QSO","quantity":10.5,"uom":"Kg","unit":"kilogramos","warehouseExternalId":"Central"}]},
  {"externalId":"SO-2","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":"2026-10-21",
   "lines":[{"externalId":"SO-2-1","productExternalId":"ACE","quantity":10,"uom":"Caja","unit":"cajas","warehouseExternalId":"Central"},
            {"externalId":"SO-2-2","productExternalId":"ACE","quantity":5,"uom":"Caja","unit":"cajas","warehouseExternalId":"Norte"}]},
  {"externalId":"SO-UNIT","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":null,
   "lines":[{"externalId":"SO-UNIT-1","productExternalId":"ACE","quantity":3,"uom":"Kg","unit":"kilogramos","warehouseExternalId":null}]},
  {"externalId":"SO-PROD","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":null,
   "lines":[{"externalId":"SO-PROD-1","productExternalId":"NO-EXISTE","quantity":3,"uom":"Caja","unit":"cajas","warehouseExternalId":null}]},
  {"externalId":"SO-DEC","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":null,
   "lines":[{"externalId":"SO-DEC-1","productExternalId":"ACE","quantity":2.5,"uom":"Caja","unit":"cajas","warehouseExternalId":null}]},
  {"externalId":"SO-EMPTY","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":null,"lines":[]}
]$json$, true);

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(not has_table_privilege('anon', 'public.erp_stock_balances', 'select'), 'anon no lee saldos');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.dispatch_order_lines', 'select'), 'anon no lee líneas');
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.erp_stock_balances', 'insert')
  and not has_table_privilege('authenticated', 'public.erp_stock_balances', 'update')
  and not has_table_privilege('authenticated', 'public.erp_stock_balances', 'delete'),
  'authenticated no escribe saldos');
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.dispatch_order_lines', 'insert')
  and not has_table_privilege('authenticated', 'public.dispatch_order_lines', 'update')
  and not has_table_privilege('authenticated', 'public.dispatch_order_lines', 'delete'),
  'authenticated no escribe líneas');
-- TRZ-101: con varios depósitos la app elige el depósito al armar el pallet (insert), pero no lo cambia después.
select pg_temp.assert_true(has_column_privilege('authenticated', 'public.pallets', 'warehouse_code', 'insert')
  and not has_column_privilege('authenticated', 'public.pallets', 'warehouse_code', 'update'),
  'la API elige el depósito al crear el pallet y no lo cambia');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_outbox_dispatch_documents_due(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.erp_outbox_record_dispatch_document(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.erp_stock_overview()', 'execute')
  and not has_function_privilege('anon', 'public.erp_sync_save_dispatch_documents(uuid, jsonb, jsonb)', 'execute'),
  'anon no ejecuta las RPC nuevas');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.erp_pallet_stock_usage(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.enforce_erp_stock_cap()', 'execute')
  and not has_function_privilege('authenticated', 'public.erp_sync_quantity_problem(numeric, text, boolean)', 'execute'),
  'los helpers no se exponen');
select pg_temp.assert_true(not exists (select 1 from pg_proc where proname = 'erp_sync_pallet_has_history'), 'el helper de pallets importados ya no existe');

/* ---------- Primera sincronización ---------- */

set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');

do $$
declare
  run public.erp_sync_runs := pg_temp.sync('a1000000-0000-0000-0000-00000000000a',
    current_setting('test.products')::jsonb, current_setting('test.lots')::jsonb,
    current_setting('test.stock')::jsonb, current_setting('test.orders')::jsonb);
begin
  perform pg_temp.assert_true(run.status = 'partial', 'con errores la corrida queda partial');
  perform pg_temp.assert_true(run.counters->'stock' = '{"received":7,"created":6,"updated":0,"unchanged":0,"failed":1,"absent":0}',
    'contadores de saldos: ' || (run.counters->'stock')::text);
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'entity' = 'stock' and e->>'external_id' = 'L-2@Sin vincular' and e->>'message' like '%no está en su lista de depósitos%'),
    'un depósito sin vincular da error auditado');
  perform pg_temp.assert_true((run.counters->'orders'->>'created')::int = 2 and (run.counters->'orders'->>'failed')::int = 4,
    'contadores de órdenes: ' || (run.counters->'orders')::text);
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'SO-UNIT' and e->>'message' like '%pero el producto se mide en cajas%'), 'orden rechazada por unidad');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'SO-PROD' and e->>'message' like '%no está sincronizado%'), 'orden rechazada por producto desconocido');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'SO-DEC' and e->>'message' like '%no es entera%'), 'orden rechazada por cantidad inválida');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'SO-EMPTY' and e->>'message' like '%no trae líneas%'), 'orden sin líneas rechazada');
end;
$$;

select pg_temp.assert_true((select count(*) from pallets where company_id = 'a1000000-0000-0000-0000-00000000000a') = 0,
  'la sincronización no crea pallets');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 6, 'un saldo por lote × depósito del ERP');
select pg_temp.assert_true((pg_temp.balance('L-1', 'Norte')).warehouse_code = 'DEP-01'
  and (pg_temp.balance('L-1', 'Norte')).quantity = 30 and (pg_temp.balance('L-1', 'Norte')).external_uom = 'Caja',
  'el saldo guarda el depósito de TrazFlow resuelto y la unidad del ERP');
select pg_temp.assert_true((pg_temp.balance('Q-1', 'Central')).quantity = 356.5, 'saldo decimal en kilogramos');
select pg_temp.assert_true((select count(*) from dispatch_orders where external_id in ('SO-UNIT', 'SO-PROD', 'SO-DEC', 'SO-EMPTY')) = 0,
  'las órdenes rechazadas no se importan');
select pg_temp.assert_true(
  (select array_agg(external_id || '=' || quantity order by external_id) from dispatch_order_lines) =
  array['SO-1-1=65', 'SO-1-2=10.5', 'SO-2-1=10', 'SO-2-2=5'],
  'las órdenes en borrador se importan con sus líneas');
select pg_temp.assert_true(
  (select bool_and(line.company_id = orders.company_id and line.product_id = product.id and line.external_uom is not null)
   from dispatch_order_lines line join dispatch_orders orders on orders.id = line.order_id
   join products product on product.external_id = case when line.external_id = 'SO-1-2' then 'QSO' else 'ACE' end),
  'líneas con empresa, producto y unidad del ERP');

/* ---------- Segunda sincronización: cantidades, synced_at y ausentes ---------- */

reset role;
update erp_stock_balances set synced_at = '2026-01-01', quantity_changed_at = '2026-01-01';
set local role authenticated;

do $$
declare
  run public.erp_sync_runs := pg_temp.sync('a1000000-0000-0000-0000-00000000000a',
    current_setting('test.products')::jsonb, current_setting('test.lots')::jsonb,
    -- X-1 cambia de 10 a 12; Q-1 deja de venir; L-2@Sin vincular sigue fallando.
    (select jsonb_agg(case when item->>'lotExternalId' = 'X-1' then jsonb_set(item, '{quantity}', '12') else item end)
     from jsonb_array_elements(current_setting('test.stock')::jsonb) item where item->>'lotExternalId' <> 'Q-1'),
    current_setting('test.orders')::jsonb);
begin
  perform pg_temp.assert_true(run.counters->'stock' = '{"received":6,"created":0,"updated":1,"unchanged":4,"failed":1,"absent":1}',
    'contadores de saldos (segunda vez): ' || (run.counters->'stock')::text);
  perform pg_temp.assert_true((run.counters->'orders'->>'created')::int = 0 and (run.counters->'orders'->>'unchanged')::int = 2,
    'las órdenes no se duplican: ' || (run.counters->'orders')::text);
end;
$$;

select pg_temp.assert_true((pg_temp.balance('X-1', 'Central')).quantity = 12
  and (pg_temp.balance('X-1', 'Central')).quantity_changed_at = now(), 'quantity_changed_at cambia si cambia la cantidad');
select pg_temp.assert_true((pg_temp.balance('L-1', 'Central')).quantity_changed_at = '2026-01-01',
  'quantity_changed_at no cambia si la cantidad es la misma');
select pg_temp.assert_true((pg_temp.balance('Q-1', 'Central')).quantity = 0
  and (pg_temp.balance('Q-1', 'Central')).quantity_changed_at = now(), 'un saldo que deja de venir pasa a 0');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 6, 'los saldos no se borran ni se duplican');
select pg_temp.assert_true((select bool_and(synced_at = now()) from erp_stock_balances),
  'cada sincronización actualiza synced_at de todos los saldos, también los que pasan a 0');
select pg_temp.assert_true((select count(*) from pallets where company_id = 'a1000000-0000-0000-0000-00000000000a') = 0,
  'la segunda sincronización tampoco crea pallets');

-- Q-1 vuelve con un saldo en 0 explícito y después con su saldo: se actualiza, no se crea otra fila.
do $$
declare
  run public.erp_sync_runs := pg_temp.sync('a1000000-0000-0000-0000-00000000000a', '[]', '[]',
    current_setting('test.stock')::jsonb, '[]');
begin
  perform pg_temp.assert_true((run.counters->'stock'->>'created')::int = 0, 'un saldo que vuelve no se duplica');
end;
$$;
select pg_temp.assert_true((pg_temp.balance('Q-1', 'Central')).quantity = 356.5, 'el saldo vuelve');

/* ---------- Líneas: espejo mientras la orden está en borrador ---------- */

do $$
declare
  run public.erp_sync_runs := pg_temp.sync('a1000000-0000-0000-0000-00000000000a', '[]', '[]', current_setting('test.stock')::jsonb,
    $json$[{"externalId":"SO-1","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":"2026-10-20",
      "lines":[{"externalId":"SO-1-1","productExternalId":"ACE","quantity":70,"uom":"Caja","unit":"cajas","warehouseExternalId":"Central"}]}]$json$);
begin
  perform pg_temp.assert_true((run.counters->'orders'->>'updated')::int = 1, 'un cambio solo en las líneas cuenta como updated: ' || (run.counters->'orders')::text);
end;
$$;
select pg_temp.assert_true(
  (select array_agg(line.external_id || '=' || line.quantity) from dispatch_order_lines line
   join dispatch_orders orders on orders.id = line.order_id where orders.external_id = 'SO-1') = array['SO-1-1=70'],
  'en borrador, las líneas se actualizan y las que dejan de venir se borran');

reset role;
update dispatch_orders set status = 'validating' where external_id = 'SO-1';
set local role authenticated;
do $$
declare
  run public.erp_sync_runs := pg_temp.sync('a1000000-0000-0000-0000-00000000000a', '[]', '[]', current_setting('test.stock')::jsonb,
    $json$[{"externalId":"SO-1","status":"pending","customer":{"externalId":"CUST-N","name":"Norte"},"scheduledDate":"2026-10-20",
      "lines":[{"externalId":"SO-1-9","productExternalId":"QSO","quantity":1,"uom":"Kg","unit":"kilogramos","warehouseExternalId":"Central"}]}]$json$);
begin
  perform pg_temp.assert_true((run.counters->'orders'->>'protected')::int = 1, 'orden avanzada protegida');
end;
$$;
select pg_temp.assert_true(
  (select array_agg(line.external_id || '=' || line.quantity) from dispatch_order_lines line
   join dispatch_orders orders on orders.id = line.order_id where orders.external_id = 'SO-1') = array['SO-1-1=70'],
  'con la orden avanzada, las líneas no se tocan');
reset role;
update dispatch_orders set status = 'draft' where external_id = 'SO-1';
set local role authenticated;

/* ---------- RLS de saldos y líneas ---------- */

select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 6, 'depósito ve los saldos de su empresa');
select pg_temp.assert_true((select count(*) from dispatch_order_lines) = 3, 'depósito ve las líneas de su empresa');
do $$
begin
  insert into public.erp_stock_balances (company_id, batch_id, external_warehouse_id, warehouse_code, quantity)
  values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-3'), 'Central', 'DEP-01', 1000);
  raise exception 'TRZ-100: se pudo escribir un saldo directo';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 0, 'el chofer no ve saldos');
select pg_temp.assert_true((select count(*) from dispatch_order_lines) = 0, 'el chofer no ve líneas de órdenes que no tiene asignadas');
reset role;
update dispatch_orders set driver_id = 'a1000000-0000-0000-0000-000000000003' where external_id = 'SO-2';
set local role authenticated;
select pg_temp.assert_true((select count(*) from dispatch_order_lines) = 2, 'el chofer ve las líneas de su orden');

select pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 0, 'otra empresa no ve saldos');
select pg_temp.assert_true((select count(*) from dispatch_order_lines) = 0, 'otra empresa no ve líneas');
select pg_temp.assert_true((select count(*) from erp_stock_overview()) = 0, 'otra empresa ve su vista vacía');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
select pg_temp.assert_raises('select * from public.erp_stock_overview()', '42501', 'el chofer no consulta la vista de stock');

/* ---------- Tope por saldo: altas y ediciones por la API ---------- */

select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');

-- L-1: 120 (Central) + 30 (Norte) = 150, los dos vinculados a DEP-01.
insert into pallets (company_id, batch_id, quantity, current_location)
values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-1'), 100, 'Depósito');
insert into pallets (company_id, batch_id, quantity, current_location)
values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-1'), 50, 'Depósito');
select pg_temp.assert_true((select count(*) from pallets where batch_id = pg_temp.lot('L-1')
  and source_system = 'trazflow' and external_id is null and status = 'in_warehouse' and warehouse_code = 'DEP-01'
  and qr_code ~ '^PAL-[0-9a-f-]{36}$') = 2,
  'se arman pallets contra un lote del ERP, sumando los dos depósitos vinculados');

do $$
declare
  v_detail text;
begin
  begin
    insert into public.pallets (company_id, batch_id, quantity)
    values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-1'), 1);
    raise exception 'TRZ-100: se superó el saldo';
  exception when sqlstate 'TF100' then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.assert_true((v_detail::jsonb->>'available')::numeric = 0 and v_detail::jsonb->>'unit' = 'cajas'
      and v_detail::jsonb->>'lot' = 'L-1' and v_detail::jsonb->>'warehouseCode' = 'DEP-01', 'detalle del error: ' || v_detail);
  end;
end;
$$;

-- Edición: bajar siempre se puede; subir respeta el tope (sin contar la fila que se edita).
update pallets set quantity = 40 where batch_id = pg_temp.lot('L-1') and quantity = 50;
select pg_temp.assert_true(pg_temp.available('L-1') = 10, 'bajar la cantidad libera saldo');
select pg_temp.assert_raises($q$update public.pallets set quantity = 51 where batch_id = pg_temp.lot('L-1') and quantity = 40$q$,
  'TF100', 'subir la cantidad por encima del saldo falla');
update pallets set quantity = 50 where batch_id = pg_temp.lot('L-1') and quantity = 40;
select pg_temp.assert_true(pg_temp.available('L-1') = 0, 'subir hasta el saldo se puede');

select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity) values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-3'), 1)$q$,
  'TF101', 'lote del ERP sin saldo en el depósito');
select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity) values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-OFF'), 1)$q$,
  'TF102', 'lote inactivo en el ERP');
select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity) values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('X-1'), 1)$q$,
  'TF102', 'producto inactivo en el ERP');
-- TRZ-101: la API puede indicar el depósito, pero tiene que existir en su empresa (FK a warehouses).
select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity, warehouse_code) values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-2'), 1, 'DEP-02')$q$,
  '23503', 'un depósito que no existe se rechaza');

-- Lotes manuales: sin tope.
insert into products (company_id, sku, name, unit_of_measure) values ('a1000000-0000-0000-0000-00000000000a', 'MAN', 'Manual', 'unidades');
insert into batches (product_id, batch_number, quantity) select id, 'MAN-1', 0 from products where sku = 'MAN' and company_id = 'a1000000-0000-0000-0000-00000000000a';
insert into pallets (company_id, batch_id, quantity)
select 'a1000000-0000-0000-0000-00000000000a', batch.id, 99999 from batches batch join products product on product.id = batch.product_id
where product.sku = 'MAN' and product.company_id = 'a1000000-0000-0000-0000-00000000000a';
select pg_temp.assert_true((select quantity from pallets where quantity = 99999) is not null, 'un lote manual no tiene tope');

/* ---------- Depósito del pallet y ubicación física ---------- */

reset role;
insert into warehouse_locations (id, company_id, code, aisle, rack, level, position)
values ('a1000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-00000000000a', 'A1', '1', '1', '1', '1');
update pallets set current_location_id = 'a1000000-0000-0000-0000-0000000000c1' where quantity = 99999;
-- TRZ-101: DEP-02 tiene que existir (FK a warehouses). Se borra al terminar este bloque para que el resto del
-- test siga con un solo depósito (los pallets se arman sin indicar depósito).
insert into warehouses (company_id, code, name) values ('a1000000-0000-0000-0000-00000000000a', 'DEP-02', 'Depósito 2');
do $$
begin
  update public.pallets set warehouse_code = 'DEP-02' where quantity = 99999;
  raise exception 'TRZ-100: un pallet con ubicación quedó en otro depósito';
exception when foreign_key_violation then null;
end;
$$;
-- Al salir del depósito se limpia la ubicación (TRZ-96) y la FK deja de aplicar.
update pallets set warehouse_code = 'DEP-02', current_location_id = null where quantity = 99999;
update pallets set warehouse_code = 'DEP-01' where quantity = 99999;
delete from warehouses where company_id = 'a1000000-0000-0000-0000-00000000000a' and code = 'DEP-02';

/* ---------- Cada fila de la regla del tope (D3) ---------- */

-- Lote L-2 (saldo 80): ocho pallets de 10, uno por situación. Se arman en depósito (pasan el tope) y después
-- se llevan a cada estado como lo harían las RPC de despacho y entrega.
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at, external_id, source_system)
select v.id, 'a1000000-0000-0000-0000-00000000000a', (select id from distributors where external_id = 'CUST-N'),
  'a1000000-0000-0000-0000-000000000001', v.status::order_status, current_date, v.confirmed_at, v.ext, case when v.ext is null then 'trazflow' else 'erp' end
from (values
  ('a2000000-0000-0000-0000-000000000003'::uuid, 'confirmed', now(), 'D3-PEND'),
  ('a2000000-0000-0000-0000-000000000004'::uuid, 'delivered', now(), 'D3-DRAFT'),
  ('a2000000-0000-0000-0000-000000000005'::uuid, 'confirmed', now(), 'D3-CONF'),
  ('a2000000-0000-0000-0000-000000000006'::uuid, 'confirmed', now(), 'D3-CANC'),
  ('a2000000-0000-0000-0000-000000000007'::uuid, 'delivered', now(), 'D3-OLD'),
  ('a2000000-0000-0000-0000-000000000008'::uuid, 'confirmed', now(), null)
) as v(id, status, confirmed_at, ext);

insert into pallets (id, company_id, batch_id, qr_code, quantity)
select ('a3000000-0000-0000-0000-00000000000' || n)::uuid, 'a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-2'), 'PAL-TRZ100-' || n, 10
from generate_series(1, 8) n;
select pg_temp.assert_true(pg_temp.available('L-2') = 0, 'ocho pallets de 10 llenan el saldo de 80');
select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity) values ('a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-2'), 1)$q$,
  'TF100', 'saldo de L-2 completo');

-- 1: en depósito. 2: asignado a SO-1 (borrador). 3..8: despachados (expected) en las órdenes de arriba.
update pallets set status = 'assigned' where id = 'a3000000-0000-0000-0000-000000000002';
insert into order_pallets (order_id, pallet_id, expected)
select (select id from dispatch_orders where external_id = 'SO-1'), 'a3000000-0000-0000-0000-000000000002', true;
insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by)
select ('a2000000-0000-0000-0000-00000000000' || n)::uuid, ('a3000000-0000-0000-0000-00000000000' || n)::uuid, true, true, now(),
  'a1000000-0000-0000-0000-000000000002'
from generate_series(3, 8) n;
update pallets set status = case when id in ('a3000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000007') then 'delivered' else 'in_transit' end::pallet_status
where id in (select ('a3000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(3, 8) n);

insert into erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, status, attempts, sent_at, erp_reference)
select ('a4000000-0000-0000-0000-00000000000' || n)::uuid, 'a1000000-0000-0000-0000-00000000000a', 'dispatch_confirmed',
  ('a2000000-0000-0000-0000-00000000000' || n)::uuid, 'dispatch:D3-' || n, '{}'::jsonb,
  case when n = 3 then 'pending' else 'sent' end, 1, case when n = 3 then null else now() end,
  case when n = 3 then null else 'MAT-DN-000' || n end
from generate_series(3, 7) n;
update erp_outbox_events set erp_document_status = 'not_tracked' where id = 'a4000000-0000-0000-0000-000000000007';

set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000005', 'confirmed', null), 'depósito registra un remito confirmado');
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000006', 'cancelled', null), 'remito anulado');
reset role;

select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000001') = 'in_warehouse', 'en depósito: cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000002') = 'in_warehouse', 'asignado a una orden en borrador: cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000003') = 'report_pending', 'reporte sin enviar: cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000004') = 'document_pending', 'remito sin consultar: cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000005') = 'confirmed_unsynced', 'confirmado sin sincronizar después: cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000006') = 'document_problem', 'remito anulado: cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000007') = 'not_tracked', 'evento not_tracked: no cuenta');
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000008') = 'manual_order', 'orden manual: no cuenta');
select pg_temp.assert_true(pg_temp.available('L-2') = 20, 'cuentan 6 de los 8 pallets: disponible 20');

-- Remito en borrador: sigue contando.
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'draft', null), 'remito en borrador');
reset role;
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000004') = 'document_pending', 'remito en borrador: cuenta');

-- No encontrado: cuenta, igual que anulado.
set local role authenticated;
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000006', 'not_found', null), 'remito no encontrado');
reset role;
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000006') = 'document_problem', 'remito no encontrado: cuenta');

-- El saldo se sincroniza DESPUÉS de que TrazFlow vio la confirmación: el pallet confirmado se libera.
update erp_outbox_events set erp_document_confirmed_seen_at = now() - interval '1 hour' where id = 'a4000000-0000-0000-0000-000000000005';
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000005') = 'released', 'confirmado y sincronizado después: no cuenta');
select pg_temp.assert_true(pg_temp.available('L-2') = 30, 'el pallet liberado devuelve su cantidad al disponible');
-- Si uno de los saldos del lote (el más viejo) es anterior a la confirmación, todavía no se libera.
update erp_stock_balances set synced_at = now() - interval '2 hours' where batch_id = pg_temp.lot('L-2') and external_warehouse_id = 'Central';
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000005') = 'confirmed_unsynced', 'se compara contra el saldo más viejo del lote');
update erp_stock_balances set synced_at = now() where batch_id = pg_temp.lot('L-2');

-- Un pallet que salió sin despacho confirmado (no debería pasar) cuenta, por las dudas.
update pallets set status = 'in_transit' where id = 'a3000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(pg_temp.phase('a3000000-0000-0000-0000-000000000001') = 'departed_without_dispatch', 'salida sin despacho: cuenta');
update pallets set status = 'in_warehouse' where id = 'a3000000-0000-0000-0000-000000000001';

-- Los pallets despachados no se tocan al bajar el saldo, pero el disponible puede quedar negativo (aviso en la vista).
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
do $$
declare
  run public.erp_sync_runs := pg_temp.sync('a1000000-0000-0000-0000-00000000000a', '[]', '[]',
    (select jsonb_agg(case when item->>'lotExternalId' = 'L-2' and item->>'warehouseExternalId' = 'Central' then jsonb_set(item, '{quantity}', '40') else item end)
     from jsonb_array_elements(current_setting('test.stock')::jsonb) item), '[]');
begin
  perform pg_temp.assert_true((run.counters->'stock'->>'updated')::int = 1, 'el saldo de L-2 baja a 40');
end;
$$;

/* ---------- Vista "Stock según ERP" ---------- */

select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
do $$
declare
  l1 record;
  l2 record;
begin
  select * into l1 from public.erp_stock_overview() where batch_number = 'L-1';
  select * into l2 from public.erp_stock_overview() where batch_number = 'L-2';
  perform pg_temp.assert_true(l1.erp_quantity = 150 and l1.built = 150 and l1.dispatched_pending = 0 and l1.available = 0
    and l1.warehouse_code = 'DEP-01' and l1.expiration_date = '2027-03-31' and l1.unit_of_measure = 'cajas'
    and l1.document_label is null, 'fila de L-1: ' || row_to_json(l1)::text);
  -- L-2: saldo 40; armado 20 (pallets 1 y 2); despachado que cuenta 30 (3 pendiente, 4 borrador, 6 no encontrado).
  perform pg_temp.assert_true(l2.erp_quantity = 40 and l2.built = 20 and l2.dispatched_pending = 30 and l2.available = -10,
    'fila de L-2 con disponible negativo: ' || row_to_json(l2)::text);
  perform pg_temp.assert_true(l2.document_label = 'document_problem', 'un remito anulado o no encontrado tiene prioridad en la etiqueta');
  perform pg_temp.assert_true(l2.awaiting_quantity = 20 and l2.awaiting_references = array['MAT-DN-0004'],
    'despachado esperando remito, con su referencia: ' || row_to_json(l2)::text);
  perform pg_temp.assert_true((select lot_active from public.erp_stock_overview() where batch_number = 'L-OFF') = false
    and (select product_active from public.erp_stock_overview() where batch_number = 'X-1') = false, 'la vista marca lotes y productos inactivos');
  perform pg_temp.assert_true((select count(*) from public.erp_stock_overview()) = 5,
    'una fila por lote × depósito de TrazFlow (los dos saldos de L-1 se suman)');
end;
$$;

-- Etiquetas: se resuelve el no encontrado y se envía el pendiente → "Esperando remito"; se confirman → "falta
-- sincronizar"; el saldo se sincroniza después → sin etiqueta.
reset role;
update erp_outbox_events set erp_document_status = 'confirmed', erp_document_confirmed_seen_at = now() where id = 'a4000000-0000-0000-0000-000000000006';
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select document_label from erp_stock_overview() where batch_number = 'L-2') = 'awaiting_document', 'etiqueta: esperando remito');
reset role;
update erp_outbox_events set status = 'sent', sent_at = now(), erp_document_status = 'confirmed', erp_document_confirmed_seen_at = now()
where id in ('a4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert_true((select document_label from erp_stock_overview() where batch_number = 'L-2') = 'confirmed_unsynced', 'etiqueta: falta sincronizar');
reset role;
update erp_stock_balances set synced_at = now() + interval '1 minute' where batch_id = pg_temp.lot('L-2');
set local role authenticated;
select pg_temp.assert_true((select document_label from erp_stock_overview() where batch_number = 'L-2') is null
  and (select available from erp_stock_overview() where batch_number = 'L-2') = 20,
  'con el saldo sincronizado después de las confirmaciones, sin etiqueta y con el disponible liberado');

/* ---------- RPC del estado del remito ---------- */

-- Logística y depósito de la empresa: sí. Otra empresa, chofer: no.
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
reset role;
update erp_outbox_events set erp_document_status = null, erp_document_checked_at = null, erp_document_confirmed_seen_at = null
where id = 'a4000000-0000-0000-0000-000000000004';
update erp_outbox_events set erp_document_checked_at = now() - interval '1 day' where id = 'a4000000-0000-0000-0000-000000000006';
set local role authenticated;
select pg_temp.assert_true(
  (select array_agg(id order by id) from erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a')) =
  array['a4000000-0000-0000-0000-000000000004']::uuid[],
  'a consultar: solo los enviados sin consultar, en borrador, no encontrados o anulados (ni confirmados ni not_tracked)');
reset role;
update erp_outbox_events set erp_document_status = 'cancelled' where id = 'a4000000-0000-0000-0000-000000000006';
set local role authenticated;
select pg_temp.assert_true(
  (select array_agg(id) from erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a')) =
  array['a4000000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-000000000006']::uuid[],
  'los anulados se reconsultan, después de los nunca consultados');
select pg_temp.assert_true((select count(*) from erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a', 1)) = 1, 'respeta el límite');

select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((select count(*) from erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a')) = 2, 'depósito consulta su empresa');
select pg_temp.assert_raises($q$select * from public.erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000b')$q$, '42501', 'depósito no consulta otra empresa');

select pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
select pg_temp.assert_raises($q$select * from public.erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a')$q$, '42501', 'el chofer no consulta remitos');
select pg_temp.assert_raises($q$select public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'confirmed', null)$q$, '42501', 'el chofer no registra remitos');

select pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
select pg_temp.assert_raises($q$select * from public.erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a')$q$, '42501', 'logística B no consulta la empresa A');
select pg_temp.assert_true(not public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'confirmed', null), 'logística B no registra remitos de A');

-- service_role (cron de TRZ-104): cualquier empresa, indicándola.
reset role;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select pg_temp.assert_true((select count(*) from erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000a')) = 2, 'service_role consulta la empresa indicada');
select pg_temp.assert_true((select count(*) from erp_outbox_dispatch_documents_due('a1000000-0000-0000-0000-00000000000b')) = 0, 'service_role: otra empresa, sin eventos');
select pg_temp.assert_raises($q$select * from public.erp_outbox_dispatch_documents_due(null)$q$, '22023', 'service_role tiene que indicar la empresa');
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'confirmed', 'MAT-DN-0004-1'), 'service_role registra el remito');
select pg_temp.assert_raises($q$select public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'borrador', null)$q$, '22023', 'estado inválido');
select pg_temp.assert_true(not public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000007', 'confirmed', null), 'un evento not_tracked no se consulta');
select pg_temp.assert_true(not public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000099', 'confirmed', null), 'evento inexistente');
reset role;

select pg_temp.assert_true((select erp_document_status = 'confirmed' and erp_document_confirmed_seen_at = now()
  and erp_reference = 'MAT-DN-0004-1' and erp_document_checked_at = now()
  from erp_outbox_events where id = 'a4000000-0000-0000-0000-000000000004'), 'el resultado queda en el evento');
update erp_outbox_events set erp_document_confirmed_seen_at = '2026-01-01' where id = 'a4000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'cancelled', null), 'se anula después');
select pg_temp.assert_true(public.erp_outbox_record_dispatch_document('a4000000-0000-0000-0000-000000000004', 'confirmed', ''), 'y se vuelve a confirmar');
select pg_temp.assert_true((select erp_document_confirmed_seen_at = '2026-01-01' and erp_reference = 'MAT-DN-0004-1'
  from erp_outbox_events where id = 'a4000000-0000-0000-0000-000000000004'),
  'confirmed_seen_at solo se fija la primera vez y una referencia vacía no pisa la guardada');

do $$
begin
  update public.erp_outbox_events set erp_document_status = 'confirmed' where id = 'a4000000-0000-0000-0000-000000000006';
  raise exception 'TRZ-100: se escribió el estado del remito directo';
exception when insufficient_privilege then null;
end;
$$;
reset role;
do $$
begin
  update public.erp_outbox_events set status = 'pending', sent_at = null where id = 'a4000000-0000-0000-0000-000000000004';
  raise exception 'TRZ-100: un evento con estado de remito volvió a pending';
exception when check_violation then null;
end;
$$;

/* ---------- Auditoría de la etapa en la sincronización ---------- */

set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
do $$
declare
  run_id uuid := public.erp_sync_start('a1000000-0000-0000-0000-00000000000a', auth.uid(), 'mock');
  run public.erp_sync_runs;
begin
  perform public.erp_sync_save_dispatch_documents(run_id,
    '{"received":2,"confirmed":1,"failed":1,"inventado":5,"draft":"x"}',
    '[{"entity":"otra","external_id":"dispatch:D3-6","message":"El ERP no respondió a tiempo (mock)."}]');
  run := public.erp_sync_finish(run_id, null);
  perform pg_temp.assert_true(run.counters->'dispatch_documents' = '{"received":2,"confirmed":1,"failed":1}',
    'solo contadores conocidos: ' || (run.counters->'dispatch_documents')::text);
  perform pg_temp.assert_true(run.errors = '[{"entity":"dispatch_document","external_id":"dispatch:D3-6","message":"El ERP no respondió a tiempo (mock)."}]',
    'errores con entidad fija: ' || run.errors::text);
  perform pg_temp.assert_true(run.status = 'partial', 'una falla en la consulta de remitos deja la corrida partial');
end;
$$;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
do $$
begin
  perform public.erp_sync_save_dispatch_documents((select id from public.erp_sync_runs limit 1), '{}', '[]');
  raise exception 'TRZ-100: depósito escribió en una sincronización';
exception when insufficient_privilege then null;
end;
$$;
reset role;

/* ---------- Payload del outbox: línea de la orden y cantidades reales ---------- */

-- SO-1 tiene una sola línea de aceite (SO-1-1); SO-2 tiene dos (SO-2-1 y SO-2-2).
insert into pallets (id, company_id, batch_id, qr_code, quantity, status)
values ('a3000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-2'), 'PAL-TRZ100-11', 7, 'in_warehouse'),
       ('a3000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-00000000000a', pg_temp.lot('L-2'), 'PAL-TRZ100-12', 3, 'in_warehouse');
insert into order_pallets (order_id, pallet_id, expected)
values ((select id from dispatch_orders where external_id = 'SO-2'), 'a3000000-0000-0000-0000-000000000011', true),
       ((select id from dispatch_orders where external_id = 'SO-2'), 'a3000000-0000-0000-0000-000000000012', true);
select pg_temp.assert_true(
  (public.erp_outbox_dispatch_payload((select id from dispatch_orders where external_id = 'SO-1'), 'a1000000-0000-0000-0000-000000000002', now()))->'lines'
  = '[{"orderLineExternalId":"SO-1-1","palletCode":"PAL-TRZ100-2","productExternalId":"ACE","lotExternalId":"L-2","quantity":10,"uom":"Caja"}]',
  'una sola línea del producto: orderLineExternalId informado, cantidad real del pallet');
select pg_temp.assert_true(
  (public.erp_outbox_dispatch_payload((select id from dispatch_orders where external_id = 'SO-2'), 'a1000000-0000-0000-0000-000000000002', now()))->'lines'
  = '[{"orderLineExternalId":null,"palletCode":"PAL-TRZ100-11","productExternalId":"ACE","lotExternalId":"L-2","quantity":7,"uom":"Caja"},
      {"orderLineExternalId":null,"palletCode":"PAL-TRZ100-12","productExternalId":"ACE","lotExternalId":"L-2","quantity":3,"uom":"Caja"}]',
  'dos líneas del mismo producto: orderLineExternalId null, una línea por pallet con su cantidad');

rollback;
