-- Run only locally. Fixtures and changes are rolled back.
begin;
create function pg_temp.check_result(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TRZ-115 generación: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected error %', expected;
end $$;
insert into auth.users(id,email) values
 ('31500000-0000-0000-0000-000000000001','generate-manager@test.local'),
 ('31500000-0000-0000-0000-000000000002','generate-operator@test.local'),
 ('31500000-0000-0000-0000-000000000003','generate-other@test.local');
insert into public.companies(id,name) values ('31500000-0000-0000-0000-000000000011','Generate A'),('31500000-0000-0000-0000-000000000012','Generate B');
insert into public.users(id,company_id,name,email,role) values
 ('31500000-0000-0000-0000-000000000001','31500000-0000-0000-0000-000000000011','Manager','generate-manager@test.local','logistics_manager'),
 ('31500000-0000-0000-0000-000000000002','31500000-0000-0000-0000-000000000011','Operator','generate-operator@test.local','warehouse_operator'),
 ('31500000-0000-0000-0000-000000000003','31500000-0000-0000-0000-000000000012','Other','generate-other@test.local','logistics_manager');
insert into public.warehouses(company_id,code,name,layout,active) values
 ('31500000-0000-0000-0000-000000000011','A','A','[{"label":"Sector"}]',true),
 ('31500000-0000-0000-0000-000000000011','B','B','[{"label":"Sector"}]',true),
 ('31500000-0000-0000-0000-000000000011','OFF','Off','[{"label":"Sector"}]',false),
 ('31500000-0000-0000-0000-000000000012','FOREIGN','Foreign','[{"label":"Sector"}]',true);
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle) values
 ('31500000-0000-0000-0000-000000000011','A','OLD','A'),
 ('31500000-0000-0000-0000-000000000011','B','COLLISION','B');
set local role authenticated;
select set_config('request.jwt.claim.sub','31500000-0000-0000-0000-000000000001',true);
select pg_temp.check_result((select created=1 and skipped=1 and rejected=1 from public.generate_warehouse_locations('A','[{"label":"Sector"}]',
 '[{"code":"NEW-A","aisle":"A"},{"code":"COLLISION","aisle":"C"},{"code":"NEW-D","aisle":"D"}]')), 'counts coordinates and code conflicts separately');
select pg_temp.check_result((select count(*)=2 from public.warehouse_locations where warehouse_code='A'), 'only the new coordinate is inserted');
select pg_temp.expect_error($s$select * from public.generate_warehouse_locations('A','[{"label":"Sector"}]', '[{"code":"VALID","aisle":"E"},{"code":"INVALID","aisle":"F","rack":"extra"}]')$s$,'22023');
select pg_temp.check_result(not exists(select 1 from public.warehouse_locations where code='VALID'), 'invalid request makes no partial changes');
select pg_temp.expect_error($s$select * from public.generate_warehouse_locations('A','[{"label":"Otro"}]', '[{"code":"VALID","aisle":"E"}]')$s$,'40001');
select pg_temp.expect_error($s$select * from public.generate_warehouse_locations('OFF','[{"label":"Sector"}]', '[{"code":"VALID","aisle":"E"}]')$s$,'TF112');
select pg_temp.expect_error($s$select * from public.generate_warehouse_locations('FOREIGN','[{"label":"Sector"}]', '[{"code":"VALID","aisle":"E"}]')$s$,'P0002');
select pg_temp.expect_error($s$select * from public.generate_warehouse_locations('A','[{"label":"Sector"}]', (select jsonb_agg(jsonb_build_object('code','C'||n,'aisle',n::text)) from generate_series(1,2001) n))$s$,'22023');
select set_config('request.jwt.claim.sub','31500000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error($s$select * from public.generate_warehouse_locations('A','[{"label":"Sector"}]', '[{"code":"NO","aisle":"E"}]')$s$,'42501');
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle) values ('31500000-0000-0000-0000-000000000011','A','OPERATOR','O');
select pg_temp.check_result((select count(*)=3 from public.warehouse_locations where warehouse_code='A'), 'operator retains individual creation');
rollback;
