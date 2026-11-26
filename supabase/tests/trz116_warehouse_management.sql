-- Run only on an isolated local database; all fixtures are rolled back.
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is not true then raise exception 'TRZ-116: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected %: %', expected, statement;
end $$;
insert into auth.users(id,email) values
 ('11600000-0000-0000-0000-000000000001','trz116-manager@test.local'),
 ('11600000-0000-0000-0000-000000000002','trz116-operator@test.local');
insert into public.companies(id,name) values
 ('11600000-0000-0000-0000-000000000011','TRZ116 A'),
 ('11600000-0000-0000-0000-000000000012','TRZ116 B');
insert into public.users(id,company_id,name,email,role) values
 ('11600000-0000-0000-0000-000000000001','11600000-0000-0000-0000-000000000011','Manager','trz116-manager@test.local','logistics_manager'),
 ('11600000-0000-0000-0000-000000000002','11600000-0000-0000-0000-000000000011','Operator','trz116-operator@test.local','warehouse_operator');
insert into public.warehouses(company_id,code,name,source_system,external_id) values
 ('11600000-0000-0000-0000-000000000011','ERP','ERP','erp','erp-116'),
 ('11600000-0000-0000-0000-000000000012','OTHER','Other','trazflow',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','11600000-0000-0000-0000-000000000001',true);
select public.manage_manual_warehouse('create','MANUAL','Manual');
select public.manage_manual_warehouse('rename','MANUAL','Nuevo');
select pg_temp.assert_true((select name='Nuevo' and code='MANUAL' from public.warehouses where code='MANUAL'), 'rename');
select pg_temp.expect_error($s$select public.manage_manual_warehouse('create','MANUAL','Duplicate')$s$,'23505');
select pg_temp.expect_error($s$select public.manage_manual_warehouse('rename','ERP','Nuevo')$s$,'42501');
select pg_temp.expect_error($s$select public.manage_manual_warehouse('deactivate','ERP')$s$,'42501');
select pg_temp.expect_error($s$select public.manage_manual_warehouse('rename','OTHER','Nuevo')$s$,'P0002');
select pg_temp.expect_error($s$update public.warehouses set code='EDITED' where code='MANUAL'$s$,'42501');
select set_config('request.jwt.claim.sub','11600000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error($s$select public.manage_manual_warehouse('create','NO','No')$s$,'42501');
reset role;
insert into public.products(id,company_id,sku,name,unit_of_measure) values ('11600000-0000-0000-0000-000000000021','11600000-0000-0000-0000-000000000011','P116','Product','unidades');
insert into public.batches(id,product_id,batch_number,quantity) values ('11600000-0000-0000-0000-000000000031','11600000-0000-0000-0000-000000000021','B116',10);
insert into public.pallets(id,company_id,batch_id,status,warehouse_code,current_location) values ('11600000-0000-0000-0000-000000000041','11600000-0000-0000-0000-000000000011','11600000-0000-0000-0000-000000000031','in_warehouse','MANUAL','Depósito');
set local role authenticated;
select set_config('request.jwt.claim.sub','11600000-0000-0000-0000-000000000001',true);
select pg_temp.expect_error($s$select public.manage_manual_warehouse('deactivate','MANUAL')$s$,'23514');
reset role;
update public.pallets set status='assigned' where id='11600000-0000-0000-0000-000000000041';
set local role authenticated;
select pg_temp.expect_error($s$select public.manage_manual_warehouse('deactivate','MANUAL')$s$,'23514');
reset role;
update public.pallets set status='in_transit' where id='11600000-0000-0000-0000-000000000041';
set local role authenticated;
select public.manage_manual_warehouse('deactivate','MANUAL');
select pg_temp.assert_true((select not active from public.warehouses where code='MANUAL'), 'deactivation');
reset role;
select pg_temp.expect_error($s$update public.pallets set status='in_warehouse' where id='11600000-0000-0000-0000-000000000041'$s$,'TF112');
update public.pallets set status='delivered' where id='11600000-0000-0000-0000-000000000041';
set local role authenticated;
select pg_temp.assert_true((select outcome='warehouse_inactive' from public.return_pallet_to_warehouse(
  (select qr_code from public.pallets where id='11600000-0000-0000-0000-000000000041'), 'Retorno')), 'return contract for inactive warehouse');
reset role;
rollback;
