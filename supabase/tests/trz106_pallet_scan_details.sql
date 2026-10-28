-- Ejecutar con psql -v ON_ERROR_STOP=1 en una base LOCAL migrada. Revierte sus datos.
begin;
create function pg_temp.check_scan(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TRZ-106: %', message; end if; end $$;

insert into public.companies(id, name) values
 ('10600000-0000-0000-0000-000000000001', 'Scan A'),
 ('10600000-0000-0000-0000-000000000002', 'Scan B');
insert into public.warehouses(company_id, code, name) values
 ('10600000-0000-0000-0000-000000000001', 'DEP-01', 'Depósito A');
insert into auth.users(id, email) values
 ('10600000-0000-0000-0000-000000000011', 'scan-manager@test.local'),
 ('10600000-0000-0000-0000-000000000012', 'scan-operator@test.local'),
 ('10600000-0000-0000-0000-000000000013', 'scan-driver@test.local'),
 ('10600000-0000-0000-0000-000000000014', 'scan-foreign@test.local');
insert into public.users(id, company_id, name, email, role) values
 ('10600000-0000-0000-0000-000000000011', '10600000-0000-0000-0000-000000000001', 'Logística', 'scan-manager@test.local', 'logistics_manager'),
 ('10600000-0000-0000-0000-000000000012', '10600000-0000-0000-0000-000000000001', 'Ambar', 'scan-operator@test.local', 'warehouse_operator'),
 ('10600000-0000-0000-0000-000000000013', '10600000-0000-0000-0000-000000000001', 'Chofer', 'scan-driver@test.local', 'driver_operator'),
 ('10600000-0000-0000-0000-000000000014', '10600000-0000-0000-0000-000000000002', 'Otra empresa', 'scan-foreign@test.local', 'warehouse_operator');
insert into public.products(id, company_id, sku, name, unit_of_measure) values
 ('10600000-0000-0000-0000-000000000021', '10600000-0000-0000-0000-000000000001', 'SCAN-ARROZ', 'Arroz', 'kilogramos');
insert into public.batches(id, product_id, batch_number, quantity) values
 ('10600000-0000-0000-0000-000000000031', '10600000-0000-0000-0000-000000000021', 'SCAN-LOTE', 100);
insert into public.pallets(id, company_id, batch_id, status, quantity) values
 ('10600000-0000-0000-0000-000000000041', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-000000000031', 'in_warehouse', 12.5),
 ('10600000-0000-0000-0000-000000000042', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-000000000031', 'in_warehouse', 10);
insert into public.warehouse_locations(id, company_id, code, aisle, rack, level, position) values
 ('10600000-0000-0000-0000-000000000051', '10600000-0000-0000-0000-000000000001', 'SCAN-A01', 'A', '1', '1', '1');
-- Conservar los QR generados por la base sin asumir su formato.
select set_config('test.scan_qr', (select qr_code from public.pallets where id='10600000-0000-0000-0000-000000000041'), true);
select set_config('test.empty_qr', (select qr_code from public.pallets where id='10600000-0000-0000-0000-000000000042'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10600000-0000-0000-0000-000000000012', true);
select pg_temp.check_scan((select last_event_type is null from public.get_pallet_scan_details(current_setting('test.empty_qr'))), 'sin historial no inventa una acción');
select public.assign_pallet_location('10600000-0000-0000-0000-000000000041', '10600000-0000-0000-0000-000000000051', null);
select pg_temp.check_scan((select product_name='Arroz' and batch_number='SCAN-LOTE' and quantity=12.5 and unit_of_measure='kilogramos'
  and physical_location='DEP-01 / SCAN-A01' and last_event_type='location_assigned' and actor_name='Ambar'
  and actor_role='warehouse_operator' and last_event_at is not null
  from public.get_pallet_scan_details(' ' || current_setting('test.scan_qr') || ' ')), 'datos reales y persona de la última acción');
select pg_temp.check_scan((select count(*)=0 from public.get_pallet_scan_details('NO-EXISTE')), 'QR inexistente');
select pg_temp.check_scan((select count(*)=0 from public.get_pallet_scan_details(repeat('x',513))), 'QR demasiado largo');
select pg_temp.check_scan((select to_jsonb(d) ? 'actor_name' and not (to_jsonb(d) ?| array['email','user_id','details'])
  from public.get_pallet_scan_details(current_setting('test.scan_qr')) d), 'proyección sin datos privados');
select set_config('request.jwt.claim.sub', '10600000-0000-0000-0000-000000000014', true);
select pg_temp.check_scan((select count(*)=0 from public.get_pallet_scan_details(current_setting('test.scan_qr'))), 'otra empresa no puede consultar');
select set_config('request.jwt.claim.sub', '10600000-0000-0000-0000-000000000013', true);
select pg_temp.check_scan((select count(*)=0 from public.get_pallet_scan_details(current_setting('test.scan_qr'))), 'chofer sin asignación no puede consultar');
reset role;
insert into public.distributors(id, company_id, name) values
 ('10600000-0000-0000-0000-000000000061','10600000-0000-0000-0000-000000000001','Destinatario');
insert into public.dispatch_orders(id, company_id, distributor_id, created_by, status, estimated_dispatch_date, driver_id) values
 ('10600000-0000-0000-0000-000000000071','10600000-0000-0000-0000-000000000001','10600000-0000-0000-0000-000000000061',
  '10600000-0000-0000-0000-000000000011','draft',current_date,'10600000-0000-0000-0000-000000000013');
insert into public.order_pallets(order_id, pallet_id, expected) values
 ('10600000-0000-0000-0000-000000000071','10600000-0000-0000-0000-000000000041',true);
set local role authenticated;
select pg_temp.check_scan((select actor_name='Ambar' and physical_location='DEP-01 / SCAN-A01'
  from public.get_pallet_scan_details(current_setting('test.scan_qr'))), 'chofer asignado ve ficha sin ampliar el catálogo ni users');
select pg_temp.check_scan((select count(*)=0 from public.get_pallet_scan_details(current_setting('test.empty_qr'))), 'chofer no ve otro pallet de su empresa');
reset role;
-- El evento más reciente manda, aun cuando su actor sea inconsistente: nunca filtrar una persona ajena.
insert into public.traceability_events(company_id,pallet_id,event_type,user_id,created_at) values
 ('10600000-0000-0000-0000-000000000001','10600000-0000-0000-0000-000000000041','qr_scan',
  '10600000-0000-0000-0000-000000000014',now()+interval '1 minute');
set local role authenticated;
select pg_temp.check_scan((select last_event_type='qr_scan' and actor_name is null and actor_role is null
  from public.get_pallet_scan_details(current_setting('test.scan_qr'))), 'no expone actores de otra empresa');
reset role;
update public.users set revoked_at=now() where id='10600000-0000-0000-0000-000000000013';
set local role authenticated;
select pg_temp.check_scan((select count(*)=0 from public.get_pallet_scan_details(current_setting('test.scan_qr'))), 'usuario revocado no consulta');
reset role;
select pg_temp.check_scan(not has_function_privilege('anon', 'public.get_pallet_scan_details(text)', 'execute'), 'sin acceso anónimo');
rollback;
