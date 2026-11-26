-- Local isolated database only. All fixtures and changes are rolled back.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TRZ-115: %', message; end if; end $$;
create function pg_temp.expect_error(command text, expected text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected error % for %', expected, command;
end $$;

insert into auth.users(id,email) values
 ('11500000-0000-0000-0000-000000000001','layout-manager@test.local'),
 ('11500000-0000-0000-0000-000000000002','layout-operator@test.local'),
 ('11500000-0000-0000-0000-000000000003','layout-other@test.local');
insert into public.companies(id,name) values
 ('11500000-0000-0000-0000-000000000011','Layout A'),
 ('11500000-0000-0000-0000-000000000012','Layout B');
insert into public.users(id,company_id,name,email,role) values
 ('11500000-0000-0000-0000-000000000001','11500000-0000-0000-0000-000000000011','Manager','layout-manager@test.local','logistics_manager'),
 ('11500000-0000-0000-0000-000000000002','11500000-0000-0000-0000-000000000011','Operator','layout-operator@test.local','warehouse_operator'),
 ('11500000-0000-0000-0000-000000000003','11500000-0000-0000-0000-000000000012','Other','layout-other@test.local','logistics_manager');
insert into public.warehouses(company_id,code,name) values
 ('11500000-0000-0000-0000-000000000011','A','A'),
 ('11500000-0000-0000-0000-000000000011','B','B'),
 ('11500000-0000-0000-0000-000000000011','C','C'),
 ('11500000-0000-0000-0000-000000000011','D','D'),
 ('11500000-0000-0000-0000-000000000012','A','A');
select pg_temp.assert_true((select jsonb_array_length(layout)=4 from public.warehouses where company_id='11500000-0000-0000-0000-000000000011' and code='A'), 'default layout');
select pg_temp.expect_error($s$update public.warehouses set layout='[]' where code='A'$s$, '23514');
select pg_temp.expect_error($s$update public.warehouses set layout='[{"label":" "}]' where code='A'$s$, '23514');
select pg_temp.expect_error($s$update public.warehouses set layout='[{"label":1}]' where code='A'$s$, '23514');
select pg_temp.expect_error($s$update public.warehouses set layout='{}' where code='A'$s$, '23514');
select pg_temp.expect_error($s$update public.warehouses set layout='[{"label":"1"},{"label":"2"},{"label":"3"},{"label":"4"},{"label":"5"}]' where code='A'$s$, '23514');
update public.warehouses set layout='[{"label":"Sector"},{"label":"Hilera"},{"label":"Posición"}]' where company_id='11500000-0000-0000-0000-000000000011' and code='A';
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level) values
 ('11500000-0000-0000-0000-000000000011','A','A1','1','2','3');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level) values ('11500000-0000-0000-0000-000000000011','A','A2','1','2','3')$s$, '23505');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack) values ('11500000-0000-0000-0000-000000000011','A','A3','1','2')$s$, '23514');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level,position) values ('11500000-0000-0000-0000-000000000011','A','A4','1','2','3','4')$s$, '23514');
select pg_temp.expect_error($s$update public.warehouses set layout='[{"label":"1"}]' where company_id='11500000-0000-0000-0000-000000000011' and code='A'$s$, '23514');
update public.warehouses set layout='[{"label":"Uno"},{"label":"Dos"},{"label":"Tres"}]' where company_id='11500000-0000-0000-0000-000000000011' and code='A';
update public.warehouses set layout='[{"label":"Piso"}]' where company_id='11500000-0000-0000-0000-000000000011' and code='B';
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle) values ('11500000-0000-0000-0000-000000000011','B','B1','1');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack) values ('11500000-0000-0000-0000-000000000011','B','B2','2','extra')$s$, '23514');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code) values ('11500000-0000-0000-0000-000000000011','B','B3')$s$, '23502');
update public.warehouses set layout='[{"label":"One"},{"label":"Two"}]' where company_id='11500000-0000-0000-0000-000000000011' and code='C';
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack) values ('11500000-0000-0000-0000-000000000011','C','C1','1','2');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle) values ('11500000-0000-0000-0000-000000000011','C','C2','1')$s$, '23514');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level) values ('11500000-0000-0000-0000-000000000011','C','C3','1','2','3')$s$, '23514');
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level,position) values ('11500000-0000-0000-0000-000000000011','D','D1','1','2','3','4');
select pg_temp.expect_error($s$insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level) values ('11500000-0000-0000-0000-000000000011','D','D2','1','2','3')$s$, '23514');
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level,position) values ('11500000-0000-0000-0000-000000000012','A','A1','1','2','3','4');
set local role authenticated;
select set_config('request.jwt.claim.sub','11500000-0000-0000-0000-000000000001',true);
update public.warehouses set layout='[{"label":"Renombrado"}]' where code='B';
select pg_temp.assert_true((select layout->0->>'label'='Renombrado' from public.warehouses where code='B'), 'manager can rename');
select pg_temp.expect_error($s$update public.warehouses set name='No' where code='B'$s$, '42501');
select pg_temp.assert_true(not has_column_privilege('authenticated', 'public.warehouses', 'code', 'UPDATE') and not has_column_privilege('authenticated', 'public.warehouses', 'name', 'UPDATE') and not has_column_privilege('authenticated', 'public.warehouses', 'active', 'UPDATE') and has_column_privilege('authenticated', 'public.warehouses', 'layout', 'UPDATE'), 'only layout is writable');
update public.warehouses set layout='[{"label":"No"}]' where company_id='11500000-0000-0000-0000-000000000012';
select set_config('request.jwt.claim.sub','11500000-0000-0000-0000-000000000002',true);
update public.warehouses set layout='[{"label":"No"}]' where code='B';
select pg_temp.assert_true((select layout->0->>'label'='Renombrado' from public.warehouses where code='B'), 'operator cannot update');
reset role;
select pg_temp.assert_true((select jsonb_array_length(layout)=4 from public.warehouses where company_id='11500000-0000-0000-0000-000000000012' and code='A'), 'other company unchanged');
rollback;
