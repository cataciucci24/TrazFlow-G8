-- Local database only; fixtures are rolled back.
begin;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected then return; end if;
    raise;
  end;
  raise exception 'Expected %: %', expected, statement;
end $$;
insert into auth.users(id,email) values ('11700000-0000-0000-0000-000000000001','reactivate-manager@test.local'), ('11700000-0000-0000-0000-000000000002','reactivate-operator@test.local');
insert into public.companies(id,name) values ('11700000-0000-0000-0000-000000000011','Reactivate A'), ('11700000-0000-0000-0000-000000000012','Reactivate B');
insert into public.users(id,company_id,name,email,role) values
 ('11700000-0000-0000-0000-000000000001','11700000-0000-0000-0000-000000000011','Manager','reactivate-manager@test.local','logistics_manager'),
 ('11700000-0000-0000-0000-000000000002','11700000-0000-0000-0000-000000000011','Operator','reactivate-operator@test.local','warehouse_operator');
insert into public.warehouses(company_id,code,name,source_system,external_id,active) values
 ('11700000-0000-0000-0000-000000000011','MANUAL','Manual','trazflow',null,false),
 ('11700000-0000-0000-0000-000000000011','ERP','ERP','erp','ERP',false),
 ('11700000-0000-0000-0000-000000000012','FOREIGN','Foreign','trazflow',null,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','11700000-0000-0000-0000-000000000001',true);
select public.reactivate_manual_warehouse('MANUAL');
do $$ begin if not (select active from public.warehouses where code='MANUAL') then raise exception 'activation failed'; end if; end $$;
select pg_temp.expect_error($s$select public.reactivate_manual_warehouse('ERP')$s$,'42501');
select pg_temp.expect_error($s$select public.reactivate_manual_warehouse('FOREIGN')$s$,'P0002');
select set_config('request.jwt.claim.sub','11700000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error($s$select public.reactivate_manual_warehouse('MANUAL')$s$,'42501');
rollback;
