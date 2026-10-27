-- TRZ-101: depósitos de TrazFlow (tabla warehouses) y depósitos traídos del ERP (erp_sync_apply_warehouses).
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
--
-- Empresas:
--   A  ya existía (tiene DEP-01 con una ubicación y un pallet) y tiene vínculos de antes de TRZ-101:
--      "Central" (el más viejo) y "Anexo", los dos a DEP-01.
--   B  empresa nueva con ERP: no se le carga ningún depósito.
--   C  empresa con un depósito cargado a mano (DEP-01) y sin vínculos.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-101: %', message; end if;
end;
$$;

-- Ejecuta p_sql y exige que falle con p_state.
create or replace function pg_temp.assert_raises(p_sql text, p_state text, message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TRZ-101: % (no falló)', message;
exception when others then
  if sqlstate <> p_state then
    raise exception 'TRZ-101: % (esperaba %, obtuvo %: %)', message, p_state, sqlstate, sqlerrm;
  end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
$$;

-- Una sincronización con depósitos y, opcionalmente, productos, lotes y stock. Devuelve el run cerrado.
create or replace function pg_temp.sync(p_company uuid, p_warehouses jsonb, p_products jsonb default null,
  p_lots jsonb default null, p_stock jsonb default null)
returns public.erp_sync_runs language plpgsql as $$
declare
  run_id uuid := public.erp_sync_start(p_company, auth.uid(), 'mock');
begin
  perform public.erp_sync_apply_warehouses(run_id, p_warehouses);
  if p_products is not null then perform public.erp_sync_apply_products(run_id, p_products); end if;
  if p_lots is not null then perform public.erp_sync_apply_lots(run_id, p_lots); end if;
  if p_stock is not null then perform public.erp_sync_apply_stock(run_id, p_stock); end if;
  return public.erp_sync_finish(run_id, null);
end;
$$;

/* ---------- Datos ---------- */

insert into auth.users (id, email) values
  ('71000000-0000-0000-0000-000000000001', 'trz101-manager-a@test.local'),
  ('71000000-0000-0000-0000-000000000002', 'trz101-operator-a@test.local'),
  ('71000000-0000-0000-0000-000000000003', 'trz101-driver-a@test.local'),
  ('71000000-0000-0000-0000-000000000004', 'trz101-manager-b@test.local'),
  ('71000000-0000-0000-0000-000000000005', 'trz101-manager-c@test.local');
insert into companies (id, name) values
  ('72000000-0000-0000-0000-00000000000a', 'TRZ101 A'),
  ('72000000-0000-0000-0000-00000000000b', 'TRZ101 B'),
  ('72000000-0000-0000-0000-00000000000c', 'TRZ101 C');
insert into users (id, company_id, name, email, role) values
  ('71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-00000000000a', 'Manager A', 'trz101-manager-a@test.local', 'logistics_manager'),
  ('71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-00000000000a', 'Operator A', 'trz101-operator-a@test.local', 'warehouse_operator'),
  ('71000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-00000000000a', 'Driver A', 'trz101-driver-a@test.local', 'driver_operator'),
  ('71000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-00000000000b', 'Manager B', 'trz101-manager-b@test.local', 'logistics_manager'),
  ('71000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-00000000000c', 'Manager C', 'trz101-manager-c@test.local', 'logistics_manager');

-- Onboarding: A y C tienen DEP-01 (A como lo dejó la migración para las empresas existentes). B, ninguno.
insert into warehouses (id, company_id, code, name) values
  ('73000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000a', 'DEP-01', 'Depósito principal'),
  ('73000000-0000-0000-0000-00000000000c', '72000000-0000-0000-0000-00000000000c', 'DEP-01', 'Depósito principal');

-- A: una ubicación y un pallet manual ubicado en DEP-01, de antes del ERP.
insert into warehouse_locations (id, company_id, code, aisle, rack, level, position) values
  ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-00000000000a', 'A01', '1', '1', '1', '1');
insert into products (id, company_id, sku, name, unit_of_measure) values
  ('75000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-00000000000a', 'MAN', 'Manual', 'cajas');
insert into batches (id, product_id, batch_number, quantity) values
  ('76000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', 'MAN-1', 0);
insert into pallets (id, company_id, batch_id, quantity, current_location, current_location_id) values
  ('77000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-00000000000a', '76000000-0000-0000-0000-000000000001', 10,
   'DEP-01 / A01', '74000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select warehouse_code from warehouse_locations where id = '74000000-0000-0000-0000-000000000001') = 'DEP-01'
  and (select warehouse_code from pallets where id = '77000000-0000-0000-0000-000000000001') = 'DEP-01',
  'con un solo depósito, ubicación y pallet sin depósito indicado quedan en DEP-01 (como antes)');

-- A: vínculos de antes de TRZ-101 (se cargaban a mano). Central es el más viejo.
insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by, created_at) values
  ('72000000-0000-0000-0000-00000000000a', 'Anexo', 'DEP-01', '71000000-0000-0000-0000-000000000001', now() - interval '1 day'),
  ('72000000-0000-0000-0000-00000000000a', 'Central', 'DEP-01', '71000000-0000-0000-0000-000000000001', now() - interval '2 days');

/* ---------- Esquema y privilegios ---------- */

select pg_temp.assert_true(not has_table_privilege('anon', 'public.warehouses', 'select'), 'anon no lee depósitos');
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.warehouses', 'select')
  and not has_table_privilege('authenticated', 'public.warehouses', 'insert')
  and not has_table_privilege('authenticated', 'public.warehouses', 'update')
  and not has_table_privilege('authenticated', 'public.warehouses', 'delete'),
  'authenticated solo lee depósitos');
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.erp_warehouse_mappings', 'insert')
  and not has_table_privilege('authenticated', 'public.erp_warehouse_mappings', 'delete'),
  'los vínculos ya no se escriben por la API');
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.erp_sync_apply_warehouses(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.erp_sync_apply_warehouses(uuid, jsonb)', 'execute'),
  'la RPC de depósitos es para authenticated, no anon');
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.erp_warehouse_code(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.erp_sync_save_notices(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.default_warehouse_code()', 'execute'),
  'los helpers no se exponen');
select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.warehouse_locations', 'warehouse_code', 'insert')
  and not has_column_privilege('authenticated', 'public.warehouse_locations', 'warehouse_code', 'update')
  and has_column_privilege('authenticated', 'public.pallets', 'warehouse_code', 'insert')
  and not has_column_privilege('authenticated', 'public.pallets', 'warehouse_code', 'update'),
  'el depósito se elige al crear, no se cambia');

/* ---------- Código generado ---------- */

select pg_temp.assert_true(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000a', 'Depósito Norte') = 'DEPOSITO-NORTE', 'nombre con tilde');
select pg_temp.assert_true(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000a', 'Ñandú & Cía. — Planta #2') = 'NANDU-CIA-PLANTA-2', 'símbolos y eñe');
select pg_temp.assert_true(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000a', 'Dep 01') = 'DEP-01-2', 'código que ya existe en la empresa: sufijo -2');
select pg_temp.assert_true(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000b', 'Dep 01') = 'DEP-01', 'en otra empresa el mismo código está libre');
select pg_temp.assert_true(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000a', '---') = 'DEP', 'nombre sin letras ni números');
select pg_temp.assert_true(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000a', repeat('Depósito muy largo ', 5)) ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'
  and length(public.erp_warehouse_code('72000000-0000-0000-0000-00000000000a', repeat('Depósito muy largo ', 5))) <= 36,
  'nombre largo: se recorta y respeta el formato');

/* ---------- FKs ---------- */

select pg_temp.assert_raises($q$insert into warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000a', 'NO-EXISTE', 'X1', '1', '1', '1', '9')$q$, '23503', 'ubicación en un depósito inexistente');
select pg_temp.assert_raises($q$insert into warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000c', 'DEPOSITO-NORTE', 'X1', '1', '1', '1', '9')$q$, '23503', 'ubicación en un depósito de otra empresa');
select pg_temp.assert_raises($q$insert into erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by)
  values ('72000000-0000-0000-0000-00000000000a', 'X', 'NO-EXISTE', '71000000-0000-0000-0000-000000000001')$q$, '23503', 'vínculo a un depósito inexistente');
select pg_temp.assert_raises($q$insert into erp_stock_balances (company_id, batch_id, external_warehouse_id, warehouse_code, quantity)
  values ('72000000-0000-0000-0000-00000000000a', '76000000-0000-0000-0000-000000000001', 'X', 'NO-EXISTE', 1)$q$, '23503', 'saldo en un depósito inexistente');
select pg_temp.assert_raises($q$insert into pallets (company_id, batch_id, quantity, warehouse_code)
  values ('72000000-0000-0000-0000-00000000000a', '76000000-0000-0000-0000-000000000001', 1, 'NO-EXISTE')$q$, '23503', 'pallet en un depósito inexistente');
select pg_temp.assert_raises($q$insert into warehouses (company_id, code, name) values ('72000000-0000-0000-0000-00000000000a', 'dep 02', 'x')$q$,
  '23514', 'el código respeta el formato');
select pg_temp.assert_raises($q$insert into warehouses (company_id, code, name, source_system) values ('72000000-0000-0000-0000-00000000000a', 'X2', 'x', 'erp')$q$,
  '23514', 'un depósito del ERP necesita external_id');

-- B no tiene depósitos: sin ERP no puede crear ubicaciones ni pallets hasta el onboarding.
select pg_temp.assert_raises($q$insert into warehouse_locations (company_id, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000b', 'B1', '1', '1', '1', '1')$q$, 'TF110', 'empresa sin depósitos');

/* ---------- Autorización ---------- */

set local role authenticated;

do $$
declare
  run_id uuid;
begin
  perform pg_temp.as_user('71000000-0000-0000-0000-000000000001');
  run_id := public.erp_sync_start('72000000-0000-0000-0000-00000000000a', auth.uid(), 'mock');

  perform pg_temp.as_user('71000000-0000-0000-0000-000000000002');
  begin
    perform public.erp_sync_apply_warehouses(run_id, '[]');
    raise exception 'TRZ-101: un operador aplicó depósitos en una corrida ajena';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.warehouses (company_id, code, name) values ('72000000-0000-0000-0000-00000000000a', 'X9', 'x');
    raise exception 'TRZ-101: la API creó un depósito';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user('71000000-0000-0000-0000-000000000001');
  begin
    update public.warehouses set name = 'Editado' where company_id = '72000000-0000-0000-0000-00000000000a';
    raise exception 'TRZ-101: la API editó un depósito';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.warehouses where company_id = '72000000-0000-0000-0000-00000000000a';
    raise exception 'TRZ-101: la API borró un depósito';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code)
    values ('72000000-0000-0000-0000-00000000000a', 'Texto libre', 'DEP-01');
    raise exception 'TRZ-101: la API vinculó un depósito a mano';
  exception when insufficient_privilege then null;
  end;
  perform public.erp_sync_finish(run_id, null);
end;
$$;

/* ---------- A: primera sincronización ---------- */

-- Anexo viene antes que Central en la respuesta, pero gana el vínculo más viejo (Central).
select pg_temp.as_user('71000000-0000-0000-0000-000000000001');
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000a',
    '[{"externalId":"Anexo","name":"Anexo","active":true},
      {"externalId":"Central","name":"Depósito Central","active":true},
      {"externalId":"Norte","name":"Depósito Norte","active":true},
      {"externalId":"Planta Vieja","name":"Planta Vieja","active":false},
      {"externalId":"Norte","name":"Repetido","active":true},
      {"externalId":"","name":"Sin id","active":true},
      {"externalId":"Sur","name":"Sin activo"}]',
    '[{"externalId":"P1","sku":"P1","name":"Producto 1","uom":"Caja","unit":"cajas","active":true}]',
    '[{"externalId":"L1","productExternalId":"P1","lotNumber":"L1","expirationDate":null,"active":true}]',
    '[{"productExternalId":"P1","lotExternalId":"L1","warehouseExternalId":"Central","quantity":100,"uom":"Caja","unit":"cajas"},
      {"productExternalId":"P1","lotExternalId":"L1","warehouseExternalId":"Anexo","quantity":5,"uom":"Caja","unit":"cajas"},
      {"productExternalId":"P1","lotExternalId":"L1","warehouseExternalId":"Norte","quantity":20,"uom":"Caja","unit":"cajas"}]');

  perform pg_temp.assert_true(run.counters->'warehouses' =
    '{"received":7,"created":2,"adopted":1,"merged":1,"updated":0,"unchanged":0,"failed":3,"deactivated":0}',
    'contadores de depósitos: ' || (run.counters->'warehouses')::text);
  perform pg_temp.assert_true((run.counters->'stock'->>'created')::int = 3 and (run.counters->'stock'->>'failed')::int = 0,
    'el stock entra sin errores en los depósitos importados: ' || (run.counters->'stock')::text);
  perform pg_temp.assert_true(run.status = 'partial' and jsonb_array_length(run.errors) = 3, 'solo los registros inválidos son errores: ' || run.errors::text);
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'entity' = 'warehouses' and e->>'external_id' = 'Norte' and e->>'message' like '%repetido%'), 'externalId repetido auditado');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'entity' = 'warehouses' and e->>'external_id' is null and e->>'message' like '%no trae externalId%'), 'sin externalId auditado');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.errors) e
    where e->>'external_id' = 'Sur' and e->>'message' like '%activo%'), 'sin active auditado');
  perform pg_temp.assert_true(jsonb_array_length(run.notices) = 4, 'un aviso por depósito importado, adoptado o sumado: ' || run.notices::text);
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.notices) e
    where e->>'external_id' = 'Central' and e->>'message' like '%Ya estaba vinculado a DEP-01%'), 'aviso de Central');
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.notices) e
    where e->>'external_id' = 'Norte' and e->>'message' like '%se importó como DEPOSITO-NORTE%'), 'aviso de Norte');
end;
$$;

reset role;
select pg_temp.assert_true(
  exists (select 1 from warehouses where id = '73000000-0000-0000-0000-00000000000a' and code = 'DEP-01'
    and external_id = 'Central' and source_system = 'erp' and name = 'Depósito Central' and active and synced_at is not null),
  'Central toma el lugar de DEP-01 (mismo id y código)');
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000a' and code = 'DEPOSITO-NORTE'
    and external_id = 'Norte' and source_system = 'erp' and active)
  and exists (select 1 from erp_warehouse_mappings where company_id = '72000000-0000-0000-0000-00000000000a'
    and external_warehouse_id = 'Norte' and warehouse_code = 'DEPOSITO-NORTE' and created_by = '71000000-0000-0000-0000-000000000001'),
  'Norte se crea con código generado y queda vinculado con el actor de la corrida');
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000a' and code = 'PLANTA-VIEJA' and not active),
  'un depósito deshabilitado en el ERP se importa inactivo');
select pg_temp.assert_true(
  not exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000a' and external_id = 'Anexo')
  and exists (select 1 from erp_warehouse_mappings where external_warehouse_id = 'Anexo' and warehouse_code = 'DEP-01'),
  'Anexo no crea otro depósito: sigue sumando en DEP-01');
select pg_temp.assert_true(
  (select count(*) from warehouses where company_id = '72000000-0000-0000-0000-00000000000a') = 3,
  'A tiene DEP-01, DEPOSITO-NORTE y PLANTA-VIEJA');
select pg_temp.assert_true(
  (select sum(quantity) from erp_stock_balances where company_id = '72000000-0000-0000-0000-00000000000a' and warehouse_code = 'DEP-01') = 105
  and (select sum(quantity) from erp_stock_balances where company_id = '72000000-0000-0000-0000-00000000000a' and warehouse_code = 'DEPOSITO-NORTE') = 20,
  'saldos por depósito de TrazFlow (Central + Anexo se suman en DEP-01)');
select pg_temp.assert_true(
  exists (select 1 from warehouse_locations where id = '74000000-0000-0000-0000-000000000001' and warehouse_code = 'DEP-01' and code = 'A01')
  and exists (select 1 from pallets where id = '77000000-0000-0000-0000-000000000001' and warehouse_code = 'DEP-01'
    and current_location_id = '74000000-0000-0000-0000-000000000001' and current_location = 'DEP-01 / A01'),
  'la ubicación y el pallet que ya estaban en DEP-01 no cambian');

/* ---------- A: segunda sincronización, renombre e inactivación ---------- */

set local role authenticated;
select pg_temp.as_user('71000000-0000-0000-0000-000000000001');
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000a',
    '[{"externalId":"Anexo","name":"Anexo","active":true},
      {"externalId":"Central","name":"Depósito Central","active":true},
      {"externalId":"Norte","name":"Depósito Norte","active":true},
      {"externalId":"Planta Vieja","name":"Planta Vieja","active":false}]');
  perform pg_temp.assert_true(run.counters->'warehouses' =
    '{"received":4,"created":0,"adopted":0,"merged":1,"updated":0,"unchanged":3,"failed":0,"deactivated":0}',
    'segunda sincronización sin cambios: ' || (run.counters->'warehouses')::text);
  perform pg_temp.assert_true(run.status = 'success', 'sin errores: success');

  -- El ERP renombra Norte: cambia el nombre, el código queda.
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000a',
    '[{"externalId":"Central","name":"Depósito Central","active":true},
      {"externalId":"Norte","name":"Depósito Norte Nuevo","active":true},
      {"externalId":"Planta Vieja","name":"Planta Vieja","active":false}]');
  perform pg_temp.assert_true((run.counters->'warehouses'->>'updated')::int = 1, 'renombre: ' || (run.counters->'warehouses')::text);
end;
$$;

reset role;
select pg_temp.assert_true(
  (select count(*) from warehouses where company_id = '72000000-0000-0000-0000-00000000000a') = 3
  and (select count(*) from erp_warehouse_mappings where company_id = '72000000-0000-0000-0000-00000000000a') = 4,
  'sin duplicados de depósitos ni de vínculos');
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000a' and external_id = 'Norte'
    and code = 'DEPOSITO-NORTE' and name = 'Depósito Norte Nuevo'),
  'renombrar en el ERP no cambia el código');

/* ---------- A: dos depósitos activos (ubicaciones, pallets y movimientos) ---------- */

set local role authenticated;
select pg_temp.as_user('71000000-0000-0000-0000-000000000001');

select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity)
  select '72000000-0000-0000-0000-00000000000a', id, 1 from public.batches where external_id = 'L1'$q$,
  'TF111', 'con dos depósitos activos, el pallet tiene que indicar cuál');
insert into pallets (company_id, batch_id, quantity, warehouse_code)
  select '72000000-0000-0000-0000-00000000000a', id, 20, 'DEPOSITO-NORTE' from batches where external_id = 'L1';
select set_config('test.north_pallet', (select id::text from pallets where warehouse_code = 'DEPOSITO-NORTE'), true);
select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity, warehouse_code)
  select '72000000-0000-0000-0000-00000000000a', id, 1, 'DEPOSITO-NORTE' from public.batches where external_id = 'L1'$q$,
  'TF100', 'el tope por saldo es por depósito');
insert into pallets (company_id, batch_id, quantity, warehouse_code)
  select '72000000-0000-0000-0000-00000000000a', id, 105, 'DEP-01' from batches where external_id = 'L1';
select pg_temp.assert_raises($q$insert into public.pallets (company_id, batch_id, quantity, warehouse_code)
  select '72000000-0000-0000-0000-00000000000a', id, 1, 'PLANTA-VIEJA' from public.batches where external_id = 'L1'$q$,
  'TF112', 'no se arman pallets en un depósito inactivo');
select pg_temp.assert_true(
  (select count(*) from public.erp_stock_overview() where warehouse_code = 'DEPOSITO-NORTE' and erp_quantity = 20 and available = 0) = 1
  and (select count(*) from public.erp_stock_overview() where warehouse_code = 'DEP-01' and erp_quantity = 105 and available = 0) = 1,
  'Stock según ERP: una fila por lote y depósito');

select pg_temp.as_user('71000000-0000-0000-0000-000000000002');
select pg_temp.assert_raises($q$insert into public.warehouse_locations (company_id, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000a', 'N1', '1', '1', '1', '1')$q$, 'TF111', 'con dos depósitos, la ubicación tiene que indicar cuál');
insert into warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position) values
  ('72000000-0000-0000-0000-00000000000a', 'DEPOSITO-NORTE', 'N1', '1', '1', '1', '1');
select set_config('test.north_location', (select id::text from warehouse_locations where code = 'N1'), true);
select pg_temp.assert_raises($q$insert into public.warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000a', 'PLANTA-VIEJA', 'V1', '1', '1', '1', '1')$q$, 'TF112', 'no se crean ubicaciones en un depósito inactivo');
select pg_temp.assert_raises($q$insert into public.warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000a', 'DEPOSITO-NORTE', 'A01', '9', '9', '9', '9')$q$, '23505', 'el código de ubicación sigue siendo único en la empresa');

-- Un pallet de Norte no va a una ubicación de DEP-01 (sería una transferencia), sí a una de Norte.
select pg_temp.assert_raises($q$select public.assign_pallet_location(current_setting('test.north_pallet')::uuid, '74000000-0000-0000-0000-000000000001', null)$q$,
  'TF113', 'ubicación de otro depósito');
select public.assign_pallet_location(current_setting('test.north_pallet')::uuid, current_setting('test.north_location')::uuid, null);
select pg_temp.assert_true(
  (select current_location from pallets where id = current_setting('test.north_pallet')::uuid) = 'DEPOSITO-NORTE / N1',
  'el texto de ubicación usa el código del depósito');
-- El pallet viejo de DEP-01 se sigue moviendo dentro de DEP-01.
insert into warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position) values
  ('72000000-0000-0000-0000-00000000000a', 'DEP-01', 'A02', '1', '1', '1', '2');
select public.assign_pallet_location('77000000-0000-0000-0000-000000000001',
  (select id from warehouse_locations where code = 'A02'), '74000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select current_location from pallets where id = '77000000-0000-0000-0000-000000000001') = 'DEP-01 / A02',
  'el pallet que ya estaba en DEP-01 se sigue moviendo');

/* ---------- RLS ---------- */

select pg_temp.assert_true((select count(*) from warehouses) = 3, 'depósito ve los depósitos de su empresa');
select pg_temp.as_user('71000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select count(*) from warehouses) = 0, 'el chofer no ve depósitos');
select pg_temp.as_user('71000000-0000-0000-0000-000000000005');
select pg_temp.assert_true((select count(*) from warehouses) = 1
  and (select code from warehouses) = 'DEP-01'
  and (select company_id from warehouses) = '72000000-0000-0000-0000-00000000000c',
  'otra empresa ve solo su depósito');

/* ---------- A: Norte deja de venir del ERP ---------- */

select pg_temp.as_user('71000000-0000-0000-0000-000000000001');
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000a',
    '[{"externalId":"Central","name":"Depósito Central","active":true},
      {"externalId":"Planta Vieja","name":"Planta Vieja","active":false}]');
  perform pg_temp.assert_true((run.counters->'warehouses'->>'deactivated')::int = 1, 'Norte se inactiva: ' || (run.counters->'warehouses')::text);
  perform pg_temp.assert_true(exists (select 1 from jsonb_array_elements(run.notices) e
    where e->>'external_id' = 'Norte' and e->>'message' like '%ya no viene del ERP%'), 'aviso de inactivación');
  perform pg_temp.assert_true(run.status = 'success', 'inactivar no es un error');
end;
$$;

reset role;
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000a' and code = 'DEPOSITO-NORTE' and not active)
  and exists (select 1 from erp_warehouse_mappings where external_warehouse_id = 'Norte')
  and exists (select 1 from warehouse_locations where id = current_setting('test.north_location')::uuid)
  and exists (select 1 from pallets where id = current_setting('test.north_pallet')::uuid
    and current_location_id = current_setting('test.north_location')::uuid),
  'inactivo, no borrado: vínculo, ubicación y pallet siguen');
select pg_temp.assert_raises($q$insert into warehouse_locations (company_id, warehouse_code, code, aisle, rack, level, position)
  values ('72000000-0000-0000-0000-00000000000a', 'DEPOSITO-NORTE', 'N2', '1', '1', '1', '2')$q$, 'TF112', 'no se crean ubicaciones en Norte inactivo');

set local role authenticated;
select pg_temp.as_user('71000000-0000-0000-0000-000000000001');
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000a',
    '[{"externalId":"Central","name":"Depósito Central","active":true},
      {"externalId":"Norte","name":"Depósito Norte Nuevo","active":true}]');
  -- Planta Vieja deja de venir, pero ya estaba inactiva: no se cuenta otra vez.
  perform pg_temp.assert_true((run.counters->'warehouses'->>'updated')::int = 1
    and (run.counters->'warehouses'->>'deactivated')::int = 0, 'Norte vuelve: ' || (run.counters->'warehouses')::text);
end;
$$;
reset role;
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000a' and code = 'DEPOSITO-NORTE' and active),
  'si vuelve a venir, se reactiva con el mismo código');

/* ---------- B: empresa nueva con ERP (sin depósitos) ---------- */

set local role authenticated;
select pg_temp.as_user('71000000-0000-0000-0000-000000000004');
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000b',
    '[{"externalId":"Stores - B","name":"Stores","active":true}]',
    '[{"externalId":"P1","sku":"P1","name":"Producto 1","uom":"Caja","unit":"cajas","active":true}]',
    '[{"externalId":"L1","productExternalId":"P1","lotNumber":"L1","expirationDate":null,"active":true}]',
    '[{"productExternalId":"P1","lotExternalId":"L1","warehouseExternalId":"Stores - B","quantity":7,"uom":"Caja","unit":"cajas"}]');
  perform pg_temp.assert_true(run.status = 'success', 'B: la primera sincronización crea el depósito y el stock entra sin errores: ' || run.errors::text);
  perform pg_temp.assert_true((run.counters->'warehouses'->>'created')::int = 1 and (run.counters->'stock'->>'created')::int = 1,
    'B: contadores ' || run.counters::text);
end;
$$;
select pg_temp.assert_true((select count(*) from warehouses) = 1 and (select code from warehouses) = 'STORES', 'B ve su depósito STORES');
select pg_temp.assert_true((select warehouse_code from erp_stock_balances) = 'STORES', 'B: el saldo queda en STORES');
-- Con un solo depósito, el pallet no necesita indicar cuál.
insert into pallets (company_id, batch_id, quantity) select '72000000-0000-0000-0000-00000000000b', id, 7 from batches where external_id = 'L1';
select pg_temp.assert_true((select warehouse_code from pallets) = 'STORES', 'B: el pallet queda en su único depósito');

/* ---------- C: depósito cargado a mano y sin vínculo ---------- */

select pg_temp.as_user('71000000-0000-0000-0000-000000000005');
do $$
declare
  run public.erp_sync_runs;
begin
  run := pg_temp.sync('72000000-0000-0000-0000-00000000000c', '[{"externalId":"Central","name":"Central","active":true}]');
  perform pg_temp.assert_true((run.counters->'warehouses'->>'created')::int = 1 and (run.counters->'warehouses'->>'adopted')::int = 0,
    'C: sin vínculo de antes no se adivina: ' || (run.counters->'warehouses')::text);
end;
$$;
reset role;
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000c' and code = 'DEP-01' and source_system = 'trazflow' and external_id is null)
  and exists (select 1 from warehouses where company_id = '72000000-0000-0000-0000-00000000000c' and code = 'CENTRAL' and external_id = 'Central'),
  'C: DEP-01 queda como depósito local y Central entra aparte');

rollback;
