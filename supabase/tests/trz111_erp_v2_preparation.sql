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
select set_config('test.snapshot_v2',expected_items::text,true) from public.order_pallets
 where order_id='11200000-0000-0000-0000-000000000061';
select pg_temp.check_v2(jsonb_array_length(public.erp_pallet_items_v2('11200000-0000-0000-0000-000000000001',current_setting('test.snapshot_v2')::jsonb))=2,'dos ítems resueltos, no solo encabezado');
select pg_temp.expect_v2_error($q$select public.erp_pallet_items_v2('11200000-0000-0000-0000-000000000002',current_setting('test.snapshot_v2')::jsonb)$q$,'22023');
select pg_temp.expect_v2_error($q$select public.erp_pallet_items_v2('11200000-0000-0000-0000-000000000001','[]')$q$,'22023');
select pg_temp.expect_v2_error($q$select public.erp_pallet_items_v2('11200000-0000-0000-0000-000000000001',jsonb_set(current_setting('test.snapshot_v2')::jsonb,'{0,quantity}','null'))$q$,'22023');
select pg_temp.expect_v2_error($q$select public.erp_pallet_items_v2('11200000-0000-0000-0000-000000000001',jsonb_set(current_setting('test.snapshot_v2')::jsonb,'{0,quantity}','0'))$q$,'22023');
select pg_temp.check_v2(public.erp_pallet_items_v2('11200000-0000-0000-0000-000000000001',
 current_setting('test.snapshot_v2')::jsonb || current_setting('test.snapshot_v2')::jsonb)
 @> '[{"productExternalId":"ITEM-1","quantity":20,"uom":"Box"},{"productExternalId":"ITEM-2","quantity":5,"uom":"Kg"}]'::jsonb,
 'consolida cada identidad por separado sin sumar unidades distintas');
select pg_temp.expect_v2_error($q$select public.erp_outbox_dispatch_payload_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000011',now())$q$,'23514');
select pg_temp.expect_v2_error($q$select public.erp_outbox_dispatch_payload_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000012',now())$q$,'42501');

-- La migración siguiente conecta los productores: ahora el scan activo es v2.
update public.order_pallets op set validated_at=now(),dispatch_items=expected_items,
 detected_at_dispatch=true,validated_by=(select o.created_by from public.dispatch_orders o where o.id=op.order_id)
 where order_id in ('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000062');
select pg_temp.check_v2((select count(*)=2 and bool_and(payload->>'contractVersion'='2') from public.erp_outbox_events
 where company_id in ('11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000002')),'productores activos conectados a v2');
select set_config('test.dispatch_v2',public.erp_outbox_dispatch_payload_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000011','2026-11-24T12:00:00Z')::text,true);
select pg_temp.check_v2((current_setting('test.dispatch_v2')::jsonb->>'contractVersion')='2'
 and jsonb_array_length(current_setting('test.dispatch_v2')::jsonb->'lines')=2,'despacho v2 por ítem');
select pg_temp.check_v2((select count(distinct x->>'palletCode')=1 from jsonb_array_elements(current_setting('test.dispatch_v2')::jsonb->'lines') x),'un QR repetido entre dos líneas');

-- Puede revertir el scan activo completo sin perder su clave original.
select public.erp_pallet_scan_event_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000041','unscan',now(),null);
select pg_temp.check_v2((select payload->>'contractVersion'='2' and jsonb_array_length(payload->'items')=2
 from public.erp_outbox_events where company_id='11200000-0000-0000-0000-000000000001' and event_type='pallet_unscanned'),'unscan con todos los ítems');
select public.erp_pallet_scan_event_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000041','scan',now(),current_setting('test.snapshot_v2')::jsonb);
select set_config('test.scan_v2',payload::text,true) from public.erp_outbox_events
 where company_id='11200000-0000-0000-0000-000000000001' and event_type='pallet_scanned' and payload->>'contractVersion'='2'
 order by idempotency_key desc limit 1;
select pg_temp.check_v2(jsonb_array_length(current_setting('test.scan_v2')::jsonb->'items')=2,'scan atómico con ambos ítems');
update public.products set external_uom='Changed',external_id='CHANGED' where id='11200000-0000-0000-0000-000000000021';
update public.batches set external_id='CHANGED-LOT' where id='11200000-0000-0000-0000-000000000031';
-- El snapshot pasado al unscan es deliberadamente incorrecto: no se debe usar.
select public.erp_pallet_scan_event_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000041','unscan',now(),'[]');
select pg_temp.check_v2((select payload->'items'=current_setting('test.scan_v2')::jsonb->'items'
 and payload->>'scanIdempotencyKey'=current_setting('test.scan_v2')::jsonb->>'idempotencyKey'
 from public.erp_outbox_events where company_id='11200000-0000-0000-0000-000000000001'
 and event_type='pallet_unscanned' and payload->>'scanIdempotencyKey'=current_setting('test.scan_v2')::jsonb->>'idempotencyKey'),'unscan copia el original aunque cambie el catálogo');
select public.erp_pallet_scan_event_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000041','unscan',now(),'[]');
select pg_temp.check_v2((select count(*)=2 from public.erp_outbox_events where company_id='11200000-0000-0000-0000-000000000001' and event_type='pallet_unscanned'),'unscan repetido no duplica eventos');
select pg_temp.expect_v2_error($q$select public.erp_pallet_scan_event_v2('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000042','scan',now(),current_setting('test.snapshot_v2')::jsonb)$q$,'42501');

-- Dos empresas pueden persistir el mismo dispatch:SO-SHARED sin descartarse.
insert into public.erp_outbox_events(company_id,event_type,aggregate_id,idempotency_key,payload)
select company_id,'dispatch_confirmed',id,'dispatch:SO-SHARED',public.erp_outbox_dispatch_payload_v2(id,created_by,now())
 from public.dispatch_orders where id in ('11200000-0000-0000-0000-000000000061','11200000-0000-0000-0000-000000000062');
select pg_temp.check_v2((select count(*)=2 from public.erp_outbox_events where idempotency_key='dispatch:SO-SHARED'),'idempotencia por empresa conserva ambos eventos');
-- Simula un scan v1 persistido antes del despliegue: se revierte desde su payload.
insert into public.erp_outbox_events(company_id,event_type,aggregate_id,idempotency_key,payload)
 select '11200000-0000-0000-0000-000000000002','pallet_scanned',gen_random_uuid(),'pallet-scan:SO-SHARED:'||qr_code||':99',
 jsonb_build_object('contractVersion',1,'idempotencyKey','pallet-scan:SO-SHARED:'||qr_code||':99',
 'scanIdempotencyKey','pallet-scan:SO-SHARED:'||qr_code||':99','action','scan','orderExternalId','SO-SHARED','palletCode',qr_code,
 'productExternalId','OLD-ITEM','lotExternalId','OLD-LOT','quantity',4,'uom','Old Box','at','2026-11-24T12:00:00Z')
 from public.pallets where id='11200000-0000-0000-0000-000000000042';
select public.erp_pallet_scan_event_v2('11200000-0000-0000-0000-000000000062','11200000-0000-0000-0000-000000000042','unscan',now(),null);
select pg_temp.check_v2((select payload->'items'='[{"productExternalId":"OLD-ITEM","lotExternalId":"OLD-LOT","quantity":4,"uom":"Old Box"}]'::jsonb
 from public.erp_outbox_events where company_id='11200000-0000-0000-0000-000000000002' and event_type='pallet_unscanned'),'unscan de v1 conserva el contenido original');
select pg_temp.check_v2(not has_function_privilege('authenticated','public.erp_pallet_items_v2(uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.erp_outbox_dispatch_payload_v2(uuid,uuid,timestamptz)','execute')
 and not has_function_privilege('authenticated','public.erp_pallet_scan_event_v2(uuid,uuid,text,timestamptz,jsonb)','execute'),'helpers internos no expuestos a la API');
select pg_temp.check_v2(not exists(select 1 from pg_trigger where tgname='trg_guard_mixed_erp_order' and not tgisinternal),'TM111 retirada tras integrar v2');
-- Payloads reales para contrastar también con el validador v2 de persona 2.
select current_setting('test.dispatch_v2')::jsonb as contract_payload;
select payload as contract_payload from public.erp_outbox_events
 where company_id in ('11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000002')
 and payload->>'contractVersion'='2';
rollback;
