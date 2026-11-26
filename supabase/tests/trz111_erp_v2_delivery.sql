-- Productores reales v2 con snapshots y entrega del último pallet.
-- Verifica la activación instalada, sin reemplazar triggers durante la prueba.
-- Preparación interna v2. Solo contra una base LOCAL migrada; rollback completo.
begin;
create function pg_temp.check_v2(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TRZ-111 ERP v2: %', message; end if; end $$;
create function pg_temp.expect_v2_error(statement text, expected_code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlstate = expected_code then return; end if; raise; end;
  raise exception 'Se esperaba % ejecutando %', expected_code, statement;
end $$;

insert into public.companies(id,name) values
 ('11200000-0000-0000-0000-000000000001','ERP mixtos A'),('11200000-0000-0000-0000-000000000002','ERP mixtos B');
insert into auth.users(id,email) values
 ('11200000-0000-0000-0000-000000000011','v2-a@test.local'),('11200000-0000-0000-0000-000000000012','v2-b@test.local');
insert into public.users(id,company_id,name,email,role) values
 ('11200000-0000-0000-0000-000000000011','11200000-0000-0000-0000-000000000001','Operador A','v2-a@test.local','logistics_manager'),
 ('11200000-0000-0000-0000-000000000012','11200000-0000-0000-0000-000000000002','Operador B','v2-b@test.local','logistics_manager');
insert into public.products(id,company_id,name,sku,unit_of_measure,external_id,external_uom,source_system) values
 ('11200000-0000-0000-0000-000000000021','11200000-0000-0000-0000-000000000001','Arroz A','ARZ','cajas','ITEM-1','Box','erp'),
 ('11200000-0000-0000-0000-000000000022','11200000-0000-0000-0000-000000000001','Queso A','QSO','kilogramos','ITEM-2','Kg','erp'),
 ('11200000-0000-0000-0000-000000000023','11200000-0000-0000-0000-000000000002','Arroz B','ARZ','cajas','ITEM-1','Box','erp');
insert into public.batches(id,product_id,batch_number,quantity,external_id,source_system) values
 ('11200000-0000-0000-0000-000000000031','11200000-0000-0000-0000-000000000021','LOT-1',100,'LOT-1','erp'),
 ('11200000-0000-0000-0000-000000000032','11200000-0000-0000-0000-000000000022','LOT-2',100,'LOT-2','erp'),
 ('11200000-0000-0000-0000-000000000033','11200000-0000-0000-0000-000000000023','LOT-1',100,'LOT-1','erp');
insert into public.warehouses(company_id,code,name) values
 ('11200000-0000-0000-0000-000000000001','DEP-01','Central A'),('11200000-0000-0000-0000-000000000002','DEP-01','Central B');
insert into public.erp_stock_balances(company_id,batch_id,external_warehouse_id,warehouse_code,quantity)
 select company_id,id,'WH','DEP-01',100 from public.batches where id in
 ('11200000-0000-0000-0000-000000000031','11200000-0000-0000-0000-000000000032','11200000-0000-0000-0000-000000000033');
insert into public.erp_warehouse_mappings(company_id,external_warehouse_id,warehouse_code) values
 ('11200000-0000-0000-0000-000000000001','WH','DEP-01'),('11200000-0000-0000-0000-000000000002','WH','DEP-01');
insert into public.pallets(id,company_id,batch_id,quantity,warehouse_code) values
 ('11200000-0000-0000-0000-000000000041','11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000031',10,'DEP-01'),
 ('11200000-0000-0000-0000-000000000042','11200000-0000-0000-0000-000000000002','11200000-0000-0000-0000-000000000033',4,'DEP-01');
insert into public.pallet_items(pallet_id,batch_id,quantity) values
 ('11200000-0000-0000-0000-000000000041','11200000-0000-0000-0000-000000000032',2.5);
insert into public.distributors(id,company_id,name) values
 ('11200000-0000-0000-0000-000000000051','11200000-0000-0000-0000-000000000001','Destino A'),
 ('11200000-0000-0000-0000-000000000052','11200000-0000-0000-0000-000000000002','Destino B');
insert into public.dispatch_orders(id,company_id,distributor_id,created_by,estimated_dispatch_date) values
 ('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000051','11200000-0000-0000-0000-000000000011',current_date),
 ('11200000-0000-0000-0000-000000000062','11200000-0000-0000-0000-000000000002','11200000-0000-0000-0000-000000000052','11200000-0000-0000-0000-000000000012',current_date);
insert into public.order_pallets(order_id,pallet_id,expected) values
 ('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000041',true),
 ('11200000-0000-0000-0000-000000000062','11200000-0000-0000-0000-000000000042',true);
update public.dispatch_orders set external_id='SO-SHARED',source_system='erp' where id in
 ('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000062');

insert into auth.users(id,email) values
 ('11200000-0000-0000-0000-000000000013','v2-depot@test.local'),('11200000-0000-0000-0000-000000000014','v2-driver@test.local');
insert into public.users(id,company_id,name,email,role) values
 ('11200000-0000-0000-0000-000000000013','11200000-0000-0000-0000-000000000001','Depósito A','v2-depot@test.local','warehouse_operator'),
 ('11200000-0000-0000-0000-000000000014','11200000-0000-0000-0000-000000000001','Chofer A','v2-driver@test.local','driver_operator');
update public.users set role='warehouse_operator' where id='11200000-0000-0000-0000-000000000012';
update public.dispatch_orders set driver_id='11200000-0000-0000-0000-000000000014' where id='11200000-0000-0000-0000-000000000061';
insert into public.pallets(id,company_id,batch_id,quantity,warehouse_code) values
 ('11200000-0000-0000-0000-000000000043','11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000031',4,'DEP-01');
insert into public.order_pallets(order_id,pallet_id,expected,erp_dispatch_items) values
 ('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000043',true,'[{"productExternalId":"FORGED"}]');
select pg_temp.check_v2((select erp_dispatch_items is null from public.order_pallets where pallet_id='11200000-0000-0000-0000-000000000043'),'INSERT no acepta snapshot ERP del cliente');
update public.pallets set status='assigned' where id in
 ('11200000-0000-0000-0000-000000000041','11200000-0000-0000-0000-000000000042','11200000-0000-0000-0000-000000000043');
select set_config('test.qr_mix',(select qr_code from public.pallets where id='11200000-0000-0000-0000-000000000041'),true);
select set_config('test.qr_mono',(select qr_code from public.pallets where id='11200000-0000-0000-0000-000000000043'),true);
select set_config('test.qr_b',(select qr_code from public.pallets where id='11200000-0000-0000-0000-000000000042'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','11200000-0000-0000-0000-000000000013',true);
select pg_temp.check_v2((select outcome='validated' from public.validate_order_pallet_items('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mix'),
 '[{"productSku":"ARZ","batchNumber":"LOT-1","quantity":10},{"productSku":"QSO","batchNumber":"LOT-2","quantity":2.5}]')),'scan real de ambos ítems');
select pg_temp.check_v2((select outcome='content_mismatch' from public.validate_order_pallet_items('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mix'),
 '[{"productSku":"ARZ","batchNumber":"LOT-1","quantity":9},{"productSku":"QSO","batchNumber":"LOT-2","quantity":2.5}]')),'diferencia invalida y genera unscan');
select pg_temp.check_v2((select outcome='validated' from public.validate_order_pallet_items('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mix'),
 '[{"productSku":"ARZ","batchNumber":"LOT-1","quantity":10},{"productSku":"QSO","batchNumber":"LOT-2","quantity":2.5}]')),'segunda ronda de scan');
select pg_temp.check_v2((select outcome='validated' from public.validate_order_pallet('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mono'))),'mono conserva el flujo');
reset role;
update public.order_pallets set dispatch_items='[]' where order_id='11200000-0000-0000-0000-000000000061'
  and pallet_id='11200000-0000-0000-0000-000000000041';
select pg_temp.expect_v2_error($q$update public.dispatch_orders set status='confirmed' where id='11200000-0000-0000-0000-000000000061'$q$,'23514');
update public.order_pallets set dispatch_items=expected_items where order_id='11200000-0000-0000-0000-000000000061'
  and pallet_id='11200000-0000-0000-0000-000000000041';
select pg_temp.check_v2(not exists(select 1 from pg_trigger where tgname='trg_guard_mixed_erp_order' and not tgisinternal),'activación v2 instalada');
set local role authenticated;
select set_config('request.jwt.claim.sub','11200000-0000-0000-0000-000000000013',true);
select pg_temp.check_v2((select outcome='confirmed' from public.confirm_dispatch_order('11200000-0000-0000-0000-000000000061')),'despacho mixto por productor real');
select set_config('request.jwt.claim.sub','11200000-0000-0000-0000-000000000012',true);
select * from public.validate_order_pallet('11200000-0000-0000-0000-000000000062',current_setting('test.qr_b'));
select pg_temp.check_v2((select outcome='confirmed' from public.confirm_dispatch_order('11200000-0000-0000-0000-000000000062')),'misma orden externa de otra empresa');
reset role;
select pg_temp.check_v2((select count(*)=2 from public.erp_outbox_events where idempotency_key='dispatch:SO-SHARED'),'dos empresas en outbox');
select pg_temp.check_v2((select jsonb_array_length(payload->'lines')=3 from public.erp_outbox_events
 where company_id='11200000-0000-0000-0000-000000000001' and idempotency_key='dispatch:SO-SHARED'),'dos líneas mixtas más una mono');
-- Cambia la identidad/unidad del catálogo DESPUÉS del despacho.
update public.products set external_id='CHANGED',external_uom='Changed unit' where id='11200000-0000-0000-0000-000000000022';
update public.batches set external_id='CHANGED-LOT' where id='11200000-0000-0000-0000-000000000032';
set local role authenticated;
select set_config('request.jwt.claim.sub','11200000-0000-0000-0000-000000000014',true);
select pg_temp.check_v2((select outcome='pallet_not_found' and product_name is null from public.confirm_delivery_pallet(
 '11200000-0000-0000-0000-000000000061',current_setting('test.qr_b'))),'chofer no obtiene información de pallets de otra empresa');
select pg_temp.check_v2((select outcome='delivered' from public.confirm_delivery_pallet('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mono'))),'primero recibe mono');
select pg_temp.check_v2((select status='confirmed' from public.dispatch_orders where id='11200000-0000-0000-0000-000000000061'),'no cierra antes del último pallet');
select pg_temp.check_v2((select outcome='delivered' from public.confirm_delivery_pallet_items('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mix'),null,
 '[{"productSku":"ARZ","batchNumber":"LOT-1","quantity":10},{"productSku":"QSO","batchNumber":"LOT-2","quantity":2}]')),'último pallet con diferencia');
select pg_temp.check_v2((select outcome='already_processed' from public.confirm_delivery_pallet_items('11200000-0000-0000-0000-000000000061',current_setting('test.qr_mix'),null,
 '[{"productSku":"ARZ","batchNumber":"LOT-1","quantity":10},{"productSku":"QSO","batchNumber":"LOT-2","quantity":2}]')),'reintento sin duplicados');
reset role;
select set_config('test.delivery_v2',payload::text,true) from public.erp_outbox_events where company_id='11200000-0000-0000-0000-000000000001' and event_type='delivery_confirmed';
select pg_temp.check_v2((current_setting('test.delivery_v2')::jsonb->'discrepancies'->0->'contentDifferences') @>
 '[{"expected":{"productExternalId":"ITEM-2","lotExternalId":"LOT-2","quantity":2.5,"uom":"Kg"},"detected":{"productExternalId":"ITEM-2","lotExternalId":"LOT-2","quantity":2,"uom":"Kg"}}]'::jsonb,
 'outbox incluye snapshot del último pallet y no el catálogo cambiado');
select pg_temp.check_v2((select count(*)=1 from public.erp_outbox_events where company_id='11200000-0000-0000-0000-000000000001' and event_type='delivery_confirmed'),'un solo cierre');
select pg_temp.check_v2((select count(*)=2 from public.traceability_events where order_id='11200000-0000-0000-0000-000000000061' and event_type='reception'),'reintento no agrega recepciones');
set local role authenticated;
select set_config('request.jwt.claim.sub','11200000-0000-0000-0000-000000000014',true);
insert into storage.objects(bucket_id,name,metadata) values ('delivery-receipts','11200000-0000-0000-0000-000000000001/11200000-0000-0000-0000-000000000061/v2.jpg','{"mimetype":"image/jpeg","size":4}');
select pg_temp.check_v2((select outcome='registered' from public.register_delivery_receipt('11200000-0000-0000-0000-000000000061',
 '11200000-0000-0000-0000-000000000001/11200000-0000-0000-0000-000000000061/v2.jpg','v2.jpg')),'remito firmado v2');
select set_config('request.jwt.claim.sub','11200000-0000-0000-0000-000000000011',true);
select pg_temp.check_v2((select outcome='returned' from public.return_pallet_to_warehouse(current_setting('test.qr_mix'),'Devolución completa')),'reingreso del mixto');
reset role;
insert into public.dispatch_orders(id,company_id,distributor_id,created_by,estimated_dispatch_date,source_system,external_id) values
 ('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000051','11200000-0000-0000-0000-000000000011',current_date,'erp','SO-NEW');
update public.pallets set status='assigned' where id='11200000-0000-0000-0000-000000000041';
insert into public.order_pallets(order_id,pallet_id,expected) values ('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000041',true);
select pg_temp.check_v2((select payload=current_setting('test.delivery_v2')::jsonb from public.erp_outbox_events
 where company_id='11200000-0000-0000-0000-000000000001' and event_type='delivery_confirmed'),'reingreso y reasignación no cambian el outbox histórico');
select pg_temp.check_v2((select erp_dispatch_items is null from public.order_pallets where order_id='11200000-0000-0000-0000-000000000063'),'nueva orden sin snapshot heredado');
-- Payloads reales en orden causal para contrastar con adaptadores de persona 2.
-- Un despacho v1 ya guardado se procesa sin reescribirlo.
insert into public.erp_outbox_events(company_id,event_type,aggregate_id,idempotency_key,payload) values
 ('11200000-0000-0000-0000-000000000002','dispatch_confirmed',gen_random_uuid(),'dispatch:SO-LEGACY',
 '{"contractVersion":1,"idempotencyKey":"dispatch:SO-LEGACY","orderExternalId":"SO-LEGACY","dispatchedAt":"2026-11-23T12:00:00Z","operator":{"id":"11200000-0000-0000-0000-000000000012","name":"Operador B"},"lines":[{"orderLineExternalId":null,"palletCode":"PAL-OLD","productExternalId":"ITEM-1","lotExternalId":"LOT-1","quantity":1,"uom":"Box"}]}');
select set_config('test.legacy_v1',(select payload::text from public.erp_outbox_events where idempotency_key='dispatch:SO-LEGACY'),true);
select id::text as contract_event_id,company_id::text as contract_company,payload as contract_payload from public.erp_outbox_events
 where company_id in ('11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000002')
 order by case event_type when 'pallet_scanned' then 1 when 'pallet_unscanned' then 2 when 'dispatch_confirmed' then 3 when 'delivery_confirmed' then 4 else 5 end,idempotency_key;
-- Observaciones incompletas se conservan; no se inventa unidad ni cantidad.
insert into public.traceability_events(company_id,pallet_id,order_id,event_type,user_id,details,created_at) values
 ('11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000041','11200000-0000-0000-0000-000000000063','reception',
 '11200000-0000-0000-0000-000000000014','{"detected_items":[{"productSku":"ARZ","batchNumber":"LOT-1","quantity":0},{"productSku":"QSO","batchNumber":"LOT-2","quantity":null},{"productSku":"UNKNOWN-POSITIVE","batchNumber":"UNKNOWN","quantity":3},{"productSku":"UNKNOWN","batchNumber":"UNKNOWN","quantity":null}]}',now()+interval '1 second');
select pg_temp.check_v2(public.erp_content_differences_v2('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000041') @>
 '[{"expected":null,"detected":{"productExternalId":null,"lotExternalId":null,"observedSku":"UNKNOWN","observedLot":"UNKNOWN","quantity":null,"uom":null}}]'::jsonb,'desconocidos preservados sin inventar datos');
select pg_temp.check_v2(public.erp_content_differences_v2('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000041') @>
 '[{"expected":{"productExternalId":"ITEM-1","quantity":10},"detected":null}]'::jsonb,'cero conocido equivale a faltante, sin cantidad inventada');
select pg_temp.check_v2(public.erp_content_differences_v2('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000041') @>
 '[{"expected":null,"detected":{"observedSku":"UNKNOWN-POSITIVE","quantity":3,"uom":null}}]'::jsonb,'cantidad positiva desconocida tampoco tiene unidad inventada');
select jsonb_set(current_setting('test.delivery_v2')::jsonb,'{discrepancies,0,contentDifferences}',
 public.erp_content_differences_v2('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000041')) as contract_payload;
select pg_temp.check_v2((select payload=current_setting('test.delivery_v2')::jsonb from public.erp_outbox_events
 where company_id='11200000-0000-0000-0000-000000000001' and event_type='delivery_confirmed'),'consulta nueva no reescribe el evento persistido');
-- Exportación para la prueba conjunta con el procesador real y adaptadores.
select 'TRZ111_EVENTS=' || jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,
  'idempotency_key',idempotency_key,'payload',payload,'attempts',1)
  order by case event_type when 'pallet_scanned' then 1 when 'pallet_unscanned' then 2
    when 'dispatch_confirmed' then 3 when 'delivery_confirmed' then 4 else 5 end,idempotency_key)::text
from public.erp_outbox_events where company_id in
 ('11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000002');
select 'TRZ111_INCOMPLETE=' || jsonb_set(current_setting('test.delivery_v2')::jsonb,'{discrepancies,0,contentDifferences}',
 public.erp_content_differences_v2('11200000-0000-0000-0000-000000000063','11200000-0000-0000-0000-000000000041'))::text;
rollback;
