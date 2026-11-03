-- Ejecutar únicamente contra Supabase local migrado. Todos los datos se revierten.
begin;
create temporary table imp_ids as select gen_random_uuid() company_a, gen_random_uuid() company_b,
 gen_random_uuid() manager, gen_random_uuid() other_manager, gen_random_uuid() warehouse_user, gen_random_uuid() request_a, gen_random_uuid() request_b;
grant select on imp_ids to authenticated;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Stock import test: %', message; end if; end; $$;
create function pg_temp.line(n integer, sku text, lot text, wh text default 'DEP-A', unit text default 'cajas', qty numeric default 10, expiry text default '2030-01-31') returns jsonb language sql as $$
 select jsonb_build_object('row',n,'product','Producto '||sku,'sku',sku,'unit',unit,'lot',lot,'expiration',expiry,'warehouse',wh,'quantity',qty); $$;
create function pg_temp.status(result jsonb, n integer) returns text language sql as $$
 select item->>'status' from jsonb_array_elements(result) item where (item->>'row')::integer = n; $$;
insert into public.companies(id,name) select company_a,'Imp A' from imp_ids union all select company_b,'Imp B' from imp_ids;
insert into auth.users(id,email) select id,id::text||'@imp.test' from imp_ids cross join lateral (values(manager),(other_manager),(warehouse_user)) x(id);
insert into public.users(id,company_id,name,email,role)
 select id,company,'Imp',id::text||'@imp.test',role::public.user_role from imp_ids cross join lateral
 (values(manager,company_a,'logistics_manager'),(other_manager,company_b,'logistics_manager'),(warehouse_user,company_a,'warehouse_operator')) x(id,company,role);
insert into public.warehouses(company_id,code,name) select company_a,'DEP-A','A' from imp_ids union all select company_a,'DEP-OFF','Off' from imp_ids;
update public.warehouses set active=false where code='DEP-OFF' and company_id=(select company_a from imp_ids);
insert into public.warehouses(company_id,code,name) select company_b,'DEP-B','B' from imp_ids;
insert into public.erp_warehouse_mappings(company_id,external_warehouse_id,warehouse_code,created_by) select company_a,'Central - SRV','DEP-A',null from imp_ids;

set local role authenticated;
-- Solo logística.
select set_config('request.jwt.claim.sub',(select warehouse_user::text from imp_ids),true);
do $$ begin begin perform public.import_stock_rows(gen_random_uuid(),'manual',false,'[]'); raise exception 'depósito autorizado'; exception when insufficient_privilege then null; end; end; $$;
select set_config('request.jwt.claim.sub',(select manager::text from imp_ids),true);
do $$ begin begin perform public.import_stock_rows(null,'manual',false,'[]'); raise exception 'sin clave'; exception when invalid_parameter_value then null; end;
 begin perform public.import_stock_rows(gen_random_uuid(),'manual',true,(select jsonb_agg(pg_temp.line(n,'S','L')) from generate_series(1,501) n)); raise exception 'tanda enorme'; exception when invalid_parameter_value then null; end; end; $$;

-- La validación no escribe.
create temporary table r as select public.import_stock_rows(null,'manual',true,jsonb_build_array(
 pg_temp.line(2,'NEW','L1'), pg_temp.line(3,'BAD','L1','DEP-B'), pg_temp.line(4,'OFF','L1','DEP-OFF'))) v;
select pg_temp.check_true(pg_temp.status(v,2)='ok','fila válida') from r;
select pg_temp.check_true(pg_temp.status(v,3)='warehouse_not_found','depósito de otra empresa') from r;
select pg_temp.check_true(pg_temp.status(v,4)='warehouse_not_found','depósito inactivo') from r;
select pg_temp.check_true((select count(*)=0 from public.products where sku='NEW'),'sin escrituras en validación');

-- Sin ERP: carga directa; una fila rota no frena al resto y el reintento no duplica.
create temporary table r2 as select public.import_stock_rows((select request_a from imp_ids),'manual',false,jsonb_build_array(
 pg_temp.line(2,'NEW','L1',qty=>10), pg_temp.line(3,'NEW','L2',qty=>5),
 pg_temp.line(4,'BAD','L1','DEP-B'), jsonb_build_object('row',5,'sku','X','lot','Y','expiration','no-fecha'),
 pg_temp.line(6,'KG','L1',unit=>'kilogramos',qty=>1.25), pg_temp.line(7,'FRAC','L1',qty=>1.5))) v;
select pg_temp.check_true(pg_temp.status(v,2)='imported' and pg_temp.status(v,3)='imported' and pg_temp.status(v,6)='imported','filas válidas') from r2;
select pg_temp.check_true(pg_temp.status(v,4)='warehouse_not_found' and pg_temp.status(v,5)='write_failed' and pg_temp.status(v,7)='invalid_row','filas rotas') from r2;
select pg_temp.check_true((select count(*)=2 from public.products where sku in ('NEW','KG')),'productos creados una vez');
select pg_temp.check_true((select count(*)=2 from public.batches b join public.products p on p.id=b.product_id where p.sku='NEW'),'lotes creados');
select pg_temp.check_true((select count(*)=3 and min(company_id::text)=(select company_a::text from imp_ids) from public.pallets),'un pallet por fila');
select pg_temp.check_true(pg_temp.status(public.import_stock_rows((select request_a from imp_ids),'manual',false,jsonb_build_array(pg_temp.line(2,'NEW','L1',qty=>10))),2)='imported','reintento');
select pg_temp.check_true((select count(*)=3 from public.pallets),'reintento no duplica');
-- Otro archivo con el mismo lote duplicaría stock; un lote nuevo del mismo producto sí entra; datos en conflicto, no.
create temporary table r3 as select public.import_stock_rows((select request_b from imp_ids),'manual',false,jsonb_build_array(
 pg_temp.line(2,'NEW','L1'), pg_temp.line(3,'NEW','L3'), pg_temp.line(4,'NEW','L4',unit=>'kilogramos'), pg_temp.line(5,'NEW','L2','DEP-A',expiry=>'2031-01-01'))) v;
select pg_temp.check_true(pg_temp.status(v,2)='already_has_stock','reimportar') from r3;
select pg_temp.check_true(pg_temp.status(v,3)='imported','lote nuevo') from r3;
select pg_temp.check_true(pg_temp.status(v,4)='unit_mismatch','otra unidad') from r3;
select pg_temp.check_true(pg_temp.status(v,5)='expiration_mismatch','otro vencimiento') from r3;

-- Con ERP: nada entra a TrazFlow, cada fila es un evento con payload completo.
create temporary table before_erp as select (select count(*) from public.products) products, (select count(*) from public.pallets) pallets;
grant select on before_erp to authenticated;
create temporary table r4 as select public.import_stock_rows(gen_random_uuid(),'erp',false,jsonb_build_array(
 pg_temp.line(2,'ERP-1','E1'), pg_temp.line(3,'ERP-2','E1',unit=>'kilogramos',qty=>2.5), pg_temp.line(4,'ERP-3','E1','DEP-OFF'))) v;
select pg_temp.check_true(pg_temp.status(v,2)='imported' and pg_temp.status(v,3)='imported','filas enviadas') from r4;
select pg_temp.check_true(pg_temp.status(v,4)='warehouse_not_mapped','depósito sin vínculo') from r4;
reset role;
select pg_temp.check_true((select products=(select count(*) from public.products) and pallets=(select count(*) from public.pallets) from before_erp),'el ERP es la fuente de verdad');
select pg_temp.check_true((select count(*)=2 from public.erp_outbox_events where event_type='stock_import_requested' and company_id=(select company_a from imp_ids)),'eventos');
select pg_temp.check_true((select payload->>'uom'='Kg' and payload->>'warehouseExternalId'='Central - SRV' and (payload->>'quantity')::numeric=2.5 and payload->>'expirationDate'='2030-01-31' and payload->>'idempotencyKey'=idempotency_key and status='pending'
 from public.erp_outbox_events where payload->>'sku'='ERP-2'),'payload');
-- Mientras el envío sigue vivo no se puede reimportar; si el ERP lo rechazó de forma definitiva, sí.
set local role authenticated;
select pg_temp.check_true(pg_temp.status(public.import_stock_rows(null,'erp',true,jsonb_build_array(pg_temp.line(2,'ERP-1','E1'))),2)='already_has_stock','envío vivo');
reset role;
alter table public.erp_outbox_events disable trigger trg_erp_outbox_guard;
update public.erp_outbox_events set status='failed' where payload->>'sku'='ERP-1';
alter table public.erp_outbox_events enable trigger trg_erp_outbox_guard;
set local role authenticated;
select pg_temp.check_true(pg_temp.status(public.import_stock_rows(null,'erp',true,jsonb_build_array(pg_temp.line(2,'ERP-1','E1'))),2)='ok','envío rechazado');
-- Un despacho más nuevo sale antes que las filas de una importación.
reset role;
insert into public.erp_outbox_events (company_id,event_type,aggregate_id,idempotency_key,payload)
 select company_a,'stock_entry_requested',gen_random_uuid(),'stock-entry:'||gen_random_uuid(),'{}'::jsonb from imp_ids;
select pg_temp.check_true((select idempotency_key like 'stock-entry:%' from public.erp_outbox_claim(1)),'las importaciones van al final de la cola');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select manager::text from imp_ids),true);
-- Aislamiento: otra empresa puede usar el mismo SKU y lote.
select set_config('request.jwt.claim.sub',(select other_manager::text from imp_ids),true);
select pg_temp.check_true(pg_temp.status(public.import_stock_rows(gen_random_uuid(),'manual',false,jsonb_build_array(pg_temp.line(2,'NEW','L1','DEP-B'))),2)='imported','aislamiento');
reset role;
select pg_temp.check_true(not has_table_privilege('authenticated','public.stock_import_rows','select'),'tabla privada');
select pg_temp.check_true(not has_function_privilege('anon','public.import_stock_rows(uuid,text,boolean,jsonb)','execute'),'anónimo');
rollback;
