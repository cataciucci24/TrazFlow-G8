-- TRZ-96 integration/security checks. Local migrated database only; rolls back.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/trz96_physical_locations.sql
begin;
create function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$ begin
  if value is not true then raise exception 'TRZ-96: %', message; end if;
end $$;
create function pg_temp.expect_error(statement text, expected_state text)
returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state = expected_state then return; end if;
    raise exception 'Expected %, got %: %', expected_state, actual_state, sqlerrm;
  end;
  raise exception 'Expected error %: %', expected_state, statement;
end $$;
insert into auth.users(id,email) values
 ('96000000-0000-0000-0000-000000000001','trz96-op@test.local'),
 ('96000000-0000-0000-0000-000000000002','trz96-manager@test.local'),
 ('96000000-0000-0000-0000-000000000003','trz96-driver@test.local'),
 ('96000000-0000-0000-0000-000000000004','trz96-revoked@test.local'),
 ('96000000-0000-0000-0000-000000000005','trz96-foreign@test.local');
insert into public.companies(id,name) values
 ('96000000-0000-0000-0000-000000000011','TRZ96 A'),
 ('96000000-0000-0000-0000-000000000012','TRZ96 B');
insert into public.users(id,company_id,name,email,role,revoked_at) values
 ('96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000011','Operator','trz96-op@test.local','warehouse_operator',null),
 ('96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000011','Manager','trz96-manager@test.local','logistics_manager',null),
 ('96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000011','Driver','trz96-driver@test.local','driver_operator',null),
 ('96000000-0000-0000-0000-000000000004','96000000-0000-0000-0000-000000000011','Revoked','trz96-revoked@test.local','warehouse_operator',now()),
 ('96000000-0000-0000-0000-000000000005','96000000-0000-0000-0000-000000000012','Foreign','trz96-foreign@test.local','warehouse_operator',null);
-- products.unit_of_measure is NOT NULL without a default since 20261006140000.
insert into public.products(id,company_id,sku,name,unit_of_measure) values
 ('96000000-0000-0000-0000-000000000021','96000000-0000-0000-0000-000000000011','TRZ96-A','Product A','unidades'),
 ('96000000-0000-0000-0000-000000000022','96000000-0000-0000-0000-000000000012','TRZ96-B','Product B','unidades');
insert into public.batches(id,product_id,batch_number,quantity) values
 ('96000000-0000-0000-0000-000000000031','96000000-0000-0000-0000-000000000021','TRZ96-A',10),
 ('96000000-0000-0000-0000-000000000032','96000000-0000-0000-0000-000000000022','TRZ96-B',10);
insert into public.pallets(id,company_id,batch_id,status,current_location) values
 ('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000011','96000000-0000-0000-0000-000000000031','in_warehouse','Deposito'),
 ('96000000-0000-0000-0000-000000000042','96000000-0000-0000-0000-000000000012','96000000-0000-0000-0000-000000000032','in_warehouse','Deposito');
insert into public.warehouse_locations(id,company_id,code,aisle,rack,level,position) values
 ('96000000-0000-0000-0000-000000000051','96000000-0000-0000-0000-000000000011','A01','A','1','1','1'),
 ('96000000-0000-0000-0000-000000000052','96000000-0000-0000-0000-000000000011','A02','A','1','1','2'),
 ('96000000-0000-0000-0000-000000000053','96000000-0000-0000-0000-000000000012','A01','A','1','1','1');
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true((select count(*) = 2 from public.warehouse_locations), 'RLS hides foreign locations');
insert into public.warehouse_locations(company_id,code,aisle,rack,level,position) values ('96000000-0000-0000-0000-000000000011','Z01','Z','1','1','1');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,code,aisle,rack,level,position) values ('96000000-0000-0000-0000-000000000012','B01','B','1','1','1')$s$, '42501');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,code,aisle,rack,level,position) values ('96000000-0000-0000-0000-000000000011','A01','B','1','1','1')$s$, '23505');
select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null);
select pg_temp.assert_true((select current_location_id = '96000000-0000-0000-0000-000000000051' and current_location = 'DEP-01 / A01' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'current location');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051','96000000-0000-0000-0000-000000000051')$s$, '23514');
-- A stale browser (including the loser of a concurrent first assignment) cannot overwrite.
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000052',null)$s$, '40001');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000053',null)$s$, 'P0002');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000042','96000000-0000-0000-0000-000000000051',null)$s$, 'P0002');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000099','96000000-0000-0000-0000-000000000051',null)$s$, 'P0002');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000099',null)$s$, 'P0002');
select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000052','96000000-0000-0000-0000-000000000051');
select pg_temp.assert_true((select count(*)=2 from public.movements where pallet_id='96000000-0000-0000-0000-000000000041'), 'exactly two movements; failed calls leave no history');
select pg_temp.assert_true((select count(*)=2 from public.traceability_events where pallet_id='96000000-0000-0000-0000-000000000041' and user_id='96000000-0000-0000-0000-000000000001' and details->>'user_name'='Operator' and event_type in ('location_assigned','location_changed')), 'audit author and both event kinds');
select pg_temp.expect_error($s$update public.pallets set current_location_id=null where id='96000000-0000-0000-0000-000000000041'$s$, '42501');
select pg_temp.expect_error($s$update public.pallets set current_location='Fake' where id='96000000-0000-0000-0000-000000000041'$s$, '42501');
select pg_temp.expect_error($s$insert into public.traceability_events(company_id,pallet_id,event_type,user_id) values ('96000000-0000-0000-0000-000000000011','96000000-0000-0000-0000-000000000041','location_changed','96000000-0000-0000-0000-000000000001')$s$, '42501');
select pg_temp.expect_error($s$delete from public.traceability_events where pallet_id='96000000-0000-0000-0000-000000000041'$s$, '42501');
-- Force an audit failure after the pallet UPDATE and movements INSERT.
reset role;
create function pg_temp.reject_location_audit() returns trigger language plpgsql as $$
begin raise exception 'simulated audit failure' using errcode = '23514'; end $$;
create trigger trz96_test_reject before insert on public.traceability_events
  for each row execute function pg_temp.reject_location_audit();
set local role authenticated;
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051','96000000-0000-0000-0000-000000000052')$s$, '23514');
select pg_temp.assert_true((select current_location_id='96000000-0000-0000-0000-000000000052' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'audit failure rolls back current location');
select pg_temp.assert_true((select count(*)=2 from public.movements where pallet_id='96000000-0000-0000-0000-000000000041'), 'audit failure rolls back movement');
reset role;
drop trigger trz96_test_reject on public.traceability_events;
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true((select count(*)=3 from public.warehouse_locations), 'manager reads');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null)$s$, '42501');
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.warehouse_locations), 'driver cannot read catalog');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null)$s$, '42501');
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_true((select count(*)=0 from public.warehouse_locations), 'revoked cannot read');
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null)$s$, '42501');
reset role;
update public.pallets set status='in_transit',current_location='En transito' where id='96000000-0000-0000-0000-000000000041';
select pg_temp.assert_true((select current_location_id is null from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'dispatch clears active slot');
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
select pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null)$s$, '23514');
-- Direct API status writes must not launder a dispatched pallet into a
-- warehouse state, even via assigned. Run as both internal roles.
reset role;
do $$
declare
  stored_status public.pallet_status;
  actor text;
  old_events bigint;
  old_movements bigint;
begin
  foreach stored_status in array array['in_transit', 'delivered', 'delivery_discrepancy', 'received', 'discrepancy']::public.pallet_status[] loop
    -- Trusted fixture setup, not an API transition.
    update public.pallets set status = stored_status
      where id = '96000000-0000-0000-0000-000000000041';
    select count(*) into old_events from public.traceability_events where pallet_id='96000000-0000-0000-0000-000000000041';
    select count(*) into old_movements from public.movements where pallet_id='96000000-0000-0000-0000-000000000041';
    foreach actor in array array['96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000002'] loop
      perform set_config('request.jwt.claim.sub', actor, true);
      set local role authenticated;
      perform pg_temp.expect_error($s$update public.pallets set status='in_warehouse' where id='96000000-0000-0000-0000-000000000041'$s$, '42501');
      perform pg_temp.expect_error($s$update public.pallets set status='assigned' where id='96000000-0000-0000-0000-000000000041'$s$, '42501');
      -- Including SET status=status is harmless and does not bypass the guard.
      update public.pallets set status=status where id='96000000-0000-0000-0000-000000000041';
      perform pg_temp.assert_true((select status=stored_status and current_location_id is null from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'failed direct writes preserve status and active location');
      perform pg_temp.expect_error($s$select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null)$s$,
        case when actor='96000000-0000-0000-0000-000000000001' then '23514' else '42501' end);
      reset role;
    end loop;
    perform pg_temp.assert_true((select count(*)=old_events from public.traceability_events where pallet_id='96000000-0000-0000-0000-000000000041'), 'rejected bypass creates no audit events');
    perform pg_temp.assert_true((select count(*)=old_movements from public.movements where pallet_id='96000000-0000-0000-0000-000000000041'), 'rejected bypass creates no movements');
  end loop;
end $$;
-- Preserve the direct transitions used by reservation and compensation.
update public.pallets set status='in_warehouse' where id='96000000-0000-0000-0000-000000000041';
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
update public.pallets set status='assigned' where id='96000000-0000-0000-0000-000000000041';
select pg_temp.assert_true((select status='assigned' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'reservation still works');
update public.pallets set status='in_warehouse' where id='96000000-0000-0000-0000-000000000041';
select pg_temp.assert_true((select status='in_warehouse' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'reservation compensation still works');
select pg_temp.expect_error($s$update public.pallets set status='in_transit' where id='96000000-0000-0000-0000-000000000041'$s$, '42501');
select pg_temp.expect_error($s$update public.pallets set status='delivered' where id='96000000-0000-0000-0000-000000000041'$s$, '42501');
-- Location assignment must also continue to work while assigned.
update public.pallets set status='assigned' where id='96000000-0000-0000-0000-000000000041';
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
select public.assign_pallet_location('96000000-0000-0000-0000-000000000041','96000000-0000-0000-0000-000000000051',null);
select pg_temp.assert_true((select status='assigned' and current_location_id='96000000-0000-0000-0000-000000000051' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'assigned pallet can still receive a location');
-- Exercise the real shared RPCs with the new invoker trigger installed.
reset role;
insert into public.distributors(id,company_id,name) values
 ('96000000-0000-0000-0000-000000000061','96000000-0000-0000-0000-000000000011','TRZ96 destination');
insert into public.dispatch_orders(id,company_id,distributor_id,created_by,status,estimated_dispatch_date,driver_id) values
 ('96000000-0000-0000-0000-000000000071','96000000-0000-0000-0000-000000000011','96000000-0000-0000-0000-000000000061','96000000-0000-0000-0000-000000000002','draft',current_date,'96000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
insert into public.order_pallets(order_id,pallet_id) values
 ('96000000-0000-0000-0000-000000000071','96000000-0000-0000-0000-000000000041');
select pg_temp.assert_true((select outcome='dissociated' from public.dissociate_pallet_from_order('96000000-0000-0000-0000-000000000071','96000000-0000-0000-0000-000000000041')), 'existing dissociation RPC succeeds');
select pg_temp.assert_true((select status='in_warehouse' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'dissociation restores warehouse status');
update public.pallets set status='assigned' where id='96000000-0000-0000-0000-000000000041';
insert into public.order_pallets(order_id,pallet_id) values
 ('96000000-0000-0000-0000-000000000071','96000000-0000-0000-0000-000000000041');
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true((select outcome='validated' from public.validate_order_pallet('96000000-0000-0000-0000-000000000071',(select qr_code from public.pallets where id='96000000-0000-0000-0000-000000000041'))), 'existing validation RPC succeeds');
select pg_temp.assert_true((select status='assigned' from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'validation does not change pallet status');
select pg_temp.assert_true((select outcome='confirmed' from public.confirm_dispatch_order('96000000-0000-0000-0000-000000000071')), 'existing dispatch RPC can change status');
select pg_temp.assert_true((select status='in_transit' and current_location_id is null from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'dispatch clears physical location');
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select outcome='delivered' from public.confirm_delivery_pallet('96000000-0000-0000-0000-000000000071',(select qr_code from public.pallets where id='96000000-0000-0000-0000-000000000041'),null)), 'existing delivery RPC can change status');
select pg_temp.assert_true((select status='delivered' and current_location_id is null from public.pallets where id='96000000-0000-0000-0000-000000000041'), 'delivery keeps physical location empty');
reset role;
rollback;
