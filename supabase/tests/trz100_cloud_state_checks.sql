-- TRZ-100: verificación de las migraciones sobre la réplica de la nube (trz100_cloud_state_fixture.sql).
-- Correr DESPUÉS de cargar la réplica y aplicar las migraciones de TRZ-100 (los pasos están en el fixture).
-- Ejecutar con psql -v ON_ERROR_STOP=1. Todo se revierte al final.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-100 nube: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

/* ---------- Lo que dejó la migración ---------- */

select pg_temp.assert_true(
  (select count(*) from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c') = 6
  and (select bool_and(warehouse_code = 'DEP-01') from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c'),
  'backfill: los 6 pallets (5 heredados + el manual) quedan en DEP-01');
select pg_temp.assert_true(
  (select count(*) from erp_outbox_events where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c'
     and status = 'sent' and erp_document_status = 'not_tracked' and erp_document_checked_at is null) = 4,
  'los 4 reportes ya enviados quedan not_tracked');
select pg_temp.assert_true(
  (select count(*) from erp_outbox_events where payload->'lines'->0->'orderLineExternalId' = 'null'::jsonb) = 4,
  'los payloads ya guardados no cambian');
select pg_temp.assert_true(
  (select array_agg(phase || ':' || counts order by quantity)
   from erp_pallet_stock_usage('bbbf3870-dedd-4d42-872c-a313f1e9536c')) =
  array['not_tracked:false', 'not_tracked:false', 'not_tracked:false', 'not_tracked:false', 'not_tracked:false'],
  'los heredados en tránsito y entregados no cuentan para el tope (sus eventos son not_tracked)');
select pg_temp.assert_true(
  (select status = 'in_warehouse' and current_location_id = '2079cc04-25ee-4940-a248-92fff9675acb' and quantity = 35
   from pallets where id = '8d2ce244-4df8-444e-9b2f-1f9dd2749f5b'),
  'el pallet manual LOTE-002 conserva estado, cantidad y ubicación física');
select pg_temp.assert_true((select count(*) from traceability_events where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c') = 18
  and (select count(*) from movements where pallet_id in (select id from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c')) = 3
  and (select count(*) from order_pallets where order_id in (select id from dispatch_orders where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c')) = 5,
  'la trazabilidad queda intacta');
select pg_temp.assert_true((select count(*) from dispatch_order_lines) = 0, 'las órdenes existentes quedan sin líneas');
select pg_temp.assert_true((select count(*) from erp_stock_balances) = 0, 'todavía no hay saldos: llegan con la próxima sincronización');

/* ---------- Primera sincronización con el modelo nuevo (datos del mock) ---------- */

set local role authenticated;
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
do $$
declare
  run_id uuid := public.erp_sync_start('bbbf3870-dedd-4d42-872c-a313f1e9536c', auth.uid(), 'mock');
  run public.erp_sync_runs;
begin
  perform public.erp_sync_save_dispatch_documents(run_id, '{"received":0}', '[]');
  perform public.erp_sync_apply_products(run_id, $json$[
    {"externalId":"ACE-500","sku":"ACE-500","name":"Aceite de girasol 500 ml","uom":"Caja","unit":"cajas","active":true},
    {"externalId":"ARR-1KG","sku":"ARR-1KG","name":"Arroz largo fino 1 kg","uom":"Caja","unit":"cajas","active":true},
    {"externalId":"QSO-HORMA","sku":"QSO-HORMA","name":"Queso en horma","uom":"Kg","unit":"kilogramos","active":true},
    {"externalId":"SAL-FINA","sku":"SAL-FINA","name":"Sal fina 500 g","uom":"Unidad","unit":"unidades","active":false}]$json$);
  perform public.erp_sync_apply_lots(run_id, $json$[
    {"externalId":"L-2026-0915","productExternalId":"ACE-500","lotNumber":"L-2026-0915","expirationDate":"2027-03-31","active":true},
    {"externalId":"L-2026-0921","productExternalId":"ACE-500","lotNumber":"L-2026-0921","expirationDate":"2027-04-15","active":true},
    {"externalId":"ARR-2026-08","productExternalId":"ARR-1KG","lotNumber":"ARR-2026-08","expirationDate":"2027-08-01","active":true},
    {"externalId":"ARR-2026-10","productExternalId":"ARR-1KG","lotNumber":"ARR-2026-10","expirationDate":"2027-10-01","active":true},
    {"externalId":"QSO-2026-1003","productExternalId":"QSO-HORMA","lotNumber":"QSO-2026-1003","expirationDate":"2026-12-03","active":true}]$json$);
  perform public.erp_sync_apply_stock(run_id, $json$[
    {"productExternalId":"ACE-500","lotExternalId":"L-2026-0915","warehouseExternalId":"Depósito Central - SRV","quantity":120,"uom":"Caja","unit":"cajas"},
    {"productExternalId":"ACE-500","lotExternalId":"L-2026-0921","warehouseExternalId":"Depósito Central - SRV","quantity":80,"uom":"Caja","unit":"cajas"},
    {"productExternalId":"ARR-1KG","lotExternalId":"ARR-2026-08","warehouseExternalId":"Depósito Central - SRV","quantity":200,"uom":"Caja","unit":"cajas"},
    {"productExternalId":"ARR-1KG","lotExternalId":"ARR-2026-10","warehouseExternalId":"Depósito Central - SRV","quantity":150,"uom":"Caja","unit":"cajas"},
    {"productExternalId":"QSO-HORMA","lotExternalId":"QSO-2026-1003","warehouseExternalId":"Depósito Central - SRV","quantity":356.5,"uom":"Kg","unit":"kilogramos"}]$json$);
  perform public.erp_sync_apply_orders(run_id, $json$[
    {"externalId":"SAL-ORD-2026-00012","status":"pending","customer":{"externalId":"CUST-NORTE","name":"Distribuidora Norte"},"scheduledDate":"2026-10-20",
     "lines":[{"externalId":"SAL-ORD-2026-00012-1","productExternalId":"ACE-500","quantity":65,"uom":"Caja","unit":"cajas","warehouseExternalId":"Depósito Central - SRV"}]}]$json$);
  run := public.erp_sync_finish(run_id, null);
  perform pg_temp.assert_true(run.status = 'success', 'la sincronización corre sin errores: ' || run.errors::text);
  perform pg_temp.assert_true((run.counters->'stock'->>'created')::int = 5, 'se crean los 5 saldos');
  perform pg_temp.assert_true((run.counters->'orders'->>'protected')::int = 1, 'la 00012 (confirmada) queda protegida');
end;
$$;

select pg_temp.assert_true((select count(*) from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c') = 6, 'la sincronización no crea pallets');
select pg_temp.assert_true((select count(*) from dispatch_order_lines) = 0, 'una orden confirmada no recibe líneas');
select pg_temp.assert_true(
  (select array_agg(batch_number || '=' || available || ':' || coalesce(document_label, '-') order by batch_number) from erp_stock_overview()) =
  array['ARR-2026-08=200:-', 'ARR-2026-10=150:-', 'L-2026-0915=120:-', 'L-2026-0921=80:-', 'QSO-2026-1003=356.5:-'],
  'los heredados no restan: disponible = saldo, sin etiquetas');
select pg_temp.assert_true((select count(*) from erp_outbox_dispatch_documents_due('bbbf3870-dedd-4d42-872c-a313f1e9536c')) = 0,
  'los reportes viejos no se consultan');

-- Armar pallets parciales del lote L-2026-0915 (40 + 25) y pasarse.
insert into pallets (company_id, batch_id, quantity, current_location)
values ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'e3455357-fc63-47fb-9416-8048d9e345b4', 40, 'Depósito'),
       ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'e3455357-fc63-47fb-9416-8048d9e345b4', 25, 'Depósito');
select pg_temp.assert_true((select available from erp_stock_overview() where batch_number = 'L-2026-0915') = 55, 'disponible 55 después de armar 65');
do $$
begin
  insert into public.pallets (company_id, batch_id, quantity)
  values ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'e3455357-fc63-47fb-9416-8048d9e345b4', 60);
  raise exception 'TRZ-100 nube: se superó el saldo';
exception when sqlstate 'TF100' then null;
end;
$$;

-- El pallet manual sigue editable y sin tope.
update pallets set quantity = 36 where id = '8d2ce244-4df8-444e-9b2f-1f9dd2749f5b';
select pg_temp.assert_true((select quantity from pallets where id = '8d2ce244-4df8-444e-9b2f-1f9dd2749f5b') = 36, 'el pallet manual se edita como antes');

rollback;
