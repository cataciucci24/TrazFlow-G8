-- Local database only. Fixtures and changes are rolled back.
begin;
create function pg_temp.check_result(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TRZ-115: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected error %', expected;
end $$;
insert into auth.users(id,email) values
 ('21500000-0000-0000-0000-000000000001','layout-erp-manager@test.local'),
 ('21500000-0000-0000-0000-000000000002','layout-erp-operator@test.local');
insert into public.companies(id,name) values ('21500000-0000-0000-0000-000000000011','Layout ERP');
insert into public.users(id,company_id,name,email,role) values
 ('21500000-0000-0000-0000-000000000001','21500000-0000-0000-0000-000000000011','Manager','layout-erp-manager@test.local','logistics_manager'),
 ('21500000-0000-0000-0000-000000000002','21500000-0000-0000-0000-000000000011','Operator','layout-erp-operator@test.local','warehouse_operator');
insert into public.warehouses(company_id,code,name,source_system,external_id) values
 ('21500000-0000-0000-0000-000000000011','ERP','ERP','erp','layout-erp');
set local role authenticated;
select set_config('request.jwt.claim.sub','21500000-0000-0000-0000-000000000001',true);
update public.warehouses set layout='[{"label":"Sector"},{"label":"Hilera"},{"label":"Posición"}]' where code='ERP';
select pg_temp.check_result((select jsonb_array_length(layout)=3 from public.warehouses where code='ERP'), 'manager configures ERP layout');
select pg_temp.expect_error($s$update public.warehouses set name='No' where code='ERP'$s$,'42501');
insert into public.warehouse_locations(company_id,warehouse_code,code,aisle,rack,level) values ('21500000-0000-0000-0000-000000000011','ERP','POS1','1','1','1');
select pg_temp.expect_error($s$update public.warehouses set layout='[{"label":"Piso"}]' where code='ERP'$s$,'23514');
update public.warehouses set layout='[{"label":"Área"},{"label":"Fila"},{"label":"Lugar"}]' where code='ERP';
select set_config('request.jwt.claim.sub','21500000-0000-0000-0000-000000000002',true);
update public.warehouses set layout='[{"label":"No"},{"label":"No"},{"label":"No"}]' where code='ERP';
select pg_temp.check_result((select layout->0->>'label'='Área' from public.warehouses where code='ERP'), 'operator cannot change layout');
rollback;
