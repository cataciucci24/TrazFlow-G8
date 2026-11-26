-- psql -v ON_ERROR_STOP=1 contra una base LOCAL migrada. No deja datos.
begin;
create function pg_temp.check_pallet(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TRZ-111/24: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise;
  end;
  raise exception 'Se esperaba % ejecutando %', expected_code, statement;
end $$;
insert into public.companies(id, name) values
 ('11100000-0000-0000-0000-000000000001','Mixtos A'), ('11100000-0000-0000-0000-000000000002','Mixtos B');
insert into public.warehouses(company_id, code, name) values ('11100000-0000-0000-0000-000000000001','DEP-01','Central');
insert into auth.users(id,email) values
 ('11100000-0000-0000-0000-000000000011','mixed-manager@test.local'),
 ('11100000-0000-0000-0000-000000000012','mixed-warehouse@test.local'),
 ('11100000-0000-0000-0000-000000000013','mixed-driver@test.local'),
 ('11100000-0000-0000-0000-000000000014','mixed-foreign@test.local');
insert into public.users(id,company_id,name,email,role) values
 ('11100000-0000-0000-0000-000000000011','11100000-0000-0000-0000-000000000001','Logística','mixed-manager@test.local','logistics_manager'),
 ('11100000-0000-0000-0000-000000000012','11100000-0000-0000-0000-000000000001','Depósito','mixed-warehouse@test.local','warehouse_operator'),
 ('11100000-0000-0000-0000-000000000013','11100000-0000-0000-0000-000000000001','Chofer','mixed-driver@test.local','driver_operator'),
 ('11100000-0000-0000-0000-000000000014','11100000-0000-0000-0000-000000000002','Ajeno','mixed-foreign@test.local','logistics_manager');
insert into public.products(id,company_id,name,sku,unit_of_measure) values
 ('11100000-0000-0000-0000-000000000021','11100000-0000-0000-0000-000000000001','Arroz','MIX-ARZ','cajas'),
 ('11100000-0000-0000-0000-000000000022','11100000-0000-0000-0000-000000000001','Queso','MIX-QSO','kilogramos');
insert into public.batches(id,product_id,batch_number,quantity) values
 ('11100000-0000-0000-0000-000000000031','11100000-0000-0000-0000-000000000021','MIX-L1',100),
 ('11100000-0000-0000-0000-000000000032','11100000-0000-0000-0000-000000000022','MIX-L2',100);
-- Una inserción anterior sigue creando exactamente un ítem, incluso con cantidad desconocida.
insert into public.pallets(id,company_id,batch_id,quantity) values
 ('11100000-0000-0000-0000-000000000041','11100000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000031',null);
select pg_temp.check_pallet((select count(*)=1 and bool_and(quantity is null) from public.pallet_contents where pallet_id='11100000-0000-0000-0000-000000000041'), 'puente para altas heredadas');

set local role authenticated;
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000012',true);
-- También depósito puede armar; una sola transacción y un solo QR.
select set_config('test.mixed_id',pallet_id::text,true),set_config('test.mixed_qr',qr_code,true)
from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":10},{"batch_id":"11100000-0000-0000-0000-000000000032","quantity":2.5}]','DEP-01');
select pg_temp.check_pallet((select count(*)=2 from public.pallet_contents where pallet_id=current_setting('test.mixed_id')::uuid),'dos ítems, un pallet');
select pg_temp.expect_error($q$select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":1.5}]','DEP-01')$q$,'22023');
select pg_temp.expect_error($q$select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":1},{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":1}]','DEP-01')$q$,'22023');
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000014',true);
select pg_temp.check_pallet((select count(*)=0 from public.pallet_contents),'RLS no filtra contenido de otra empresa');
select pg_temp.expect_error($q$select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":1}]','DEP-01')$q$,'22023');
reset role;
insert into public.distributors(id,company_id,name) values ('11100000-0000-0000-0000-000000000051','11100000-0000-0000-0000-000000000001','Destino');
insert into public.dispatch_orders(id,company_id,distributor_id,driver_id,created_by,estimated_dispatch_date) values
 ('11100000-0000-0000-0000-000000000061','11100000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000051','11100000-0000-0000-0000-000000000013','11100000-0000-0000-0000-000000000011',current_date);
update public.pallets set status='assigned' where id=current_setting('test.mixed_id')::uuid;
insert into public.order_pallets(order_id,pallet_id,expected) values ('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_id')::uuid,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000012',true);
select pg_temp.check_pallet((select outcome='content_required' from public.validate_order_pallet('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'))),'un QR mixto requiere comparar ítems');
select pg_temp.check_pallet((select outcome='content_mismatch' from public.validate_order_pallet_items('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'),
 '[{"productSku":"MIX-ARZ","batchNumber":"MIX-L1","quantity":9},{"productSku":"MIX-QSO","batchNumber":"MIX-L2","quantity":2.5}]')),'detecta cantidad distinta');
select pg_temp.check_pallet((select outcome='content_mismatch' from public.validate_order_pallet_items('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'),
 '[{"productSku":"MIX-ARZ","batchNumber":"OTRO","quantity":10},{"productSku":"MIX-QSO","batchNumber":"MIX-L2","quantity":2.5}]')),'detecta lote distinto');
select pg_temp.check_pallet((select outcome='validated' from public.validate_order_pallet_items('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'),
 '[{"productSku":"MIX-QSO","batchNumber":"MIX-L2","quantity":2.50},{"productSku":"MIX-ARZ","batchNumber":"MIX-L1","quantity":10}]')),'compara por identidad y cantidad, no por orden de ítems');
select pg_temp.check_pallet((select outcome='content_mismatch' from public.validate_order_pallet_items('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'),
 '[{"productSku":"MIX-ARZ","batchNumber":"MIX-L1","quantity":9},{"productSku":"MIX-QSO","batchNumber":"MIX-L2","quantity":2.5}]')),'una diferencia posterior invalida el escaneo anterior');
select pg_temp.check_pallet((select outcome='missing_pallets' from public.confirm_dispatch_order('11100000-0000-0000-0000-000000000061')),'no despacha usando una validación obsoleta');
select pg_temp.check_pallet((select outcome='validated' from public.validate_order_pallet_items('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'),
 '[{"productSku":"MIX-ARZ","batchNumber":"MIX-L1","quantity":10},{"productSku":"MIX-QSO","batchNumber":"MIX-L2","quantity":2.5}]')),'revalidación después de corregir la diferencia');
select pg_temp.check_pallet((select outcome='confirmed' from public.confirm_dispatch_order('11100000-0000-0000-0000-000000000061')),'despacha el mixto validado');
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000013',true);
select pg_temp.check_pallet((select count(*)=2 from public.get_order_delivery_pallets('11100000-0000-0000-0000-000000000061')),'chofer ve todos los ítems de su entrega');
select pg_temp.check_pallet((select outcome='content_required' from public.confirm_delivery_pallet('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'))),'recepción mixta no omite comparación');
select pg_temp.check_pallet((select outcome='delivered' from public.confirm_delivery_pallet_items('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'),null,
 '[{"productSku":"MIX-ARZ","batchNumber":"MIX-L1","quantity":8},{"productSku":"MIX-QSO","batchNumber":"MIX-L2","quantity":2.5}]')),'registra recepción con diferencia por ítem');
select pg_temp.check_pallet((select delivery_outcome='content_mismatch' and jsonb_array_length(reception_items)=2 from public.order_pallets where pallet_id=current_setting('test.mixed_id')::uuid),'persiste esperado y detectado por ítem');
select pg_temp.check_pallet((select outcome='forbidden' from public.return_pallet_to_warehouse(current_setting('test.mixed_qr'),'Error de destino')),'chofer no inicia reingreso');
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000011',true);
select pg_temp.check_pallet((select outcome='invalid_input' from public.return_pallet_to_warehouse(current_setting('test.mixed_qr'),' ')),'motivo obligatorio');
select pg_temp.check_pallet((select outcome='returned' from public.return_pallet_to_warehouse(current_setting('test.mixed_qr'),'Error de destino, pallet completo devuelto')),'logística reingresa desde entrega con diferencia');
select pg_temp.check_pallet((select status='in_warehouse' and current_location_id is null from public.pallets where id=current_setting('test.mixed_id')::uuid),'queda elegible para una nueva orden y sin posición inventada');
select pg_temp.check_pallet((select outcome='already_in_warehouse' from public.return_pallet_to_warehouse(current_setting('test.mixed_qr'),'Reintento')),'reingreso idempotente');
select pg_temp.check_pallet((select count(*)=1 from public.traceability_events where pallet_id=current_setting('test.mixed_id')::uuid and event_type='pallet_returned'),'una sola auditoría del reingreso');
select pg_temp.check_pallet((select count(*)=1 from public.get_lot_traceability('MIX-L2') where pallet_id=current_setting('test.mixed_id')::uuid and movement_resulting_status='in_warehouse'),'lote secundario conserva trazabilidad del mixto');
select pg_temp.check_pallet((select delivery_outcome='content_mismatch' and jsonb_array_length(expected_items)=2 from public.order_pallets where pallet_id=current_setting('test.mixed_id')::uuid),'reingreso no borra la entrega anterior');
insert into public.dispatch_orders(id,company_id,distributor_id,driver_id,created_by,estimated_dispatch_date) values
 ('11100000-0000-0000-0000-000000000062','11100000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000051','11100000-0000-0000-0000-000000000013','11100000-0000-0000-0000-000000000011',current_date);
update public.pallets set status='assigned' where id=current_setting('test.mixed_id')::uuid;
insert into public.order_pallets(order_id,pallet_id,expected) values ('11100000-0000-0000-0000-000000000062',current_setting('test.mixed_id')::uuid,true);
select pg_temp.check_pallet((select count(*)=2 from public.order_pallets where pallet_id=current_setting('test.mixed_id')::uuid),'reingresado se reasigna sin borrar la orden anterior');
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000013',true);
select pg_temp.check_pallet((select outcome='already_processed' from public.confirm_delivery_pallet('11100000-0000-0000-0000-000000000061',current_setting('test.mixed_qr'))),'reintentar la entrega anterior no altera la nueva asignación');
select pg_temp.check_pallet((select status='assigned' from public.pallets where id=current_setting('test.mixed_id')::uuid),'mantiene estado de la nueva orden');
reset role;
-- Tope ERP por cada ítem, incluso cuando el lote del ERP no es el de la cabecera.
select set_config('request.jwt.claim.sub','',true);
insert into public.products(id,company_id,name,sku,unit_of_measure,source_system,external_id,external_active) values
 ('11100000-0000-0000-0000-000000000023','11100000-0000-0000-0000-000000000001','ERP','MIX-ERP','cajas','erp','MIX-ERP',true);
insert into public.batches(id,product_id,batch_number,quantity,source_system,external_id,external_active) values
 ('11100000-0000-0000-0000-000000000033','11100000-0000-0000-0000-000000000023','MIX-E1',0,'erp','MIX-E1',true);
insert into public.erp_warehouse_mappings(company_id,external_warehouse_id,warehouse_code,created_by) values
 ('11100000-0000-0000-0000-000000000001','ERP-MIX-WH','DEP-01','11100000-0000-0000-0000-000000000011');
insert into public.erp_stock_balances(company_id,batch_id,external_warehouse_id,warehouse_code,quantity) values
 ('11100000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000033','ERP-MIX-WH','DEP-01',10);
insert into public.dispatch_orders(id,company_id,distributor_id,created_by,estimated_dispatch_date,source_system,external_id) values
 ('11100000-0000-0000-0000-000000000063','11100000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000051','11100000-0000-0000-0000-000000000011',current_date,'erp','MIX-ERP-ORDER');
set local role authenticated;
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000011',true);
select pg_temp.check_pallet(not exists(select 1 from pg_trigger where tgname='trg_guard_mixed_erp_order' and not tgisinternal),'ERP mixto habilitado con contrato v2');
select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":1},{"batch_id":"11100000-0000-0000-0000-000000000033","quantity":7}]','DEP-01');
select pg_temp.check_pallet((select built=7 and available=3 from public.erp_stock_overview() where batch_id='11100000-0000-0000-0000-000000000033'),'stock ERP cuenta el lote secundario del mixto');
select set_config('test.before_failed_build',(select count(*)::text from public.pallets),true);
select pg_temp.expect_error($q$select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":1},{"batch_id":"11100000-0000-0000-0000-000000000033","quantity":4}]','DEP-01')$q$,'TF100');
select pg_temp.check_pallet((select count(*)::text=current_setting('test.before_failed_build') from public.pallets),'fallar un ítem revierte todo el pallet');
select pg_temp.expect_error($q$select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000033","quantity":1}]','OTRO')$q$,'23503');
select pg_temp.expect_error($q$select * from public.create_pallet_with_items('[{"batch_id":"11100000-0000-0000-0000-000000000031","quantity":"NaN"}]','DEP-01')$q$,'22023');
select pg_temp.check_pallet(not has_function_privilege('authenticated','public.validate_order_pallet_legacy(uuid,text)','execute'),'API no elude la comparación con la función interna');
select pg_temp.check_pallet(not has_table_privilege('authenticated','public.pallet_items','insert'),'API no altera ítems fuera de la RPC');
reset role;
-- Integración TRZ-51 + TRZ-111: el remito conserva todos los ítems de ESA orden.
select pg_temp.check_pallet((select jsonb_array_length(content->'lines')=2
  and (content->'lines') @> '[{"productSku":"MIX-ARZ","quantity":10},{"productSku":"MIX-QSO","quantity":2.5}]'::jsonb
  from public.dispatch_notes where order_id='11100000-0000-0000-0000-000000000061'), 'remito completo del pallet mixto');
select public.issue_dispatch_note('11100000-0000-0000-0000-000000000061', now(), null);
select pg_temp.check_pallet((select count(*)=1 from public.dispatch_notes
  where order_id='11100000-0000-0000-0000-000000000061'), 'el remito se emite una sola vez');
select pg_temp.expect_error($q$update public.dispatch_notes set number=999 where order_id='11100000-0000-0000-0000-000000000061'$q$, '42501');
set local role authenticated;
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000014',true);
select pg_temp.check_pallet((select count(*)=0 from public.dispatch_notes), 'otra empresa no lee el remito');
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000013',true);
select pg_temp.check_pallet((select count(*)=1 from public.dispatch_notes
  where order_id='11100000-0000-0000-0000-000000000061'), 'TRZ-52: el chofer asignado lee el remito de su entrega');
select set_config('request.jwt.claim.sub','11100000-0000-0000-0000-000000000011',true);
select pg_temp.check_pallet((select count(*)=1 from public.dispatch_notes
  where order_id='11100000-0000-0000-0000-000000000061'), 'logística de la empresa lee el remito');
reset role;
rollback;
