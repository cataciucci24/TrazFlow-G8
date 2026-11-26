-- Local isolated database only; all fixtures are rolled back.
begin;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected error %', expected;
end $$;
insert into auth.users(id,email) values
 ('11800000-0000-0000-0000-000000000001','trz118-manual@test.local'),
 ('11800000-0000-0000-0000-000000000002','trz118-erp@test.local');
insert into public.companies(id,name) values
 ('11800000-0000-0000-0000-000000000011','Manual'),
 ('11800000-0000-0000-0000-000000000012','ERP');
insert into public.users(id,company_id,name,email,role) values
 ('11800000-0000-0000-0000-000000000001','11800000-0000-0000-0000-000000000011','Manager','trz118-manual@test.local','logistics_manager'),
 ('11800000-0000-0000-0000-000000000002','11800000-0000-0000-0000-000000000012','Manager','trz118-erp@test.local','logistics_manager');
insert into public.erp_company_settings(company_id,erp_provider) values ('11800000-0000-0000-0000-000000000012','mock');
-- Onboarding and ERP synchronization insert through separate paths.
insert into public.warehouses(company_id,code,name) values ('11800000-0000-0000-0000-000000000012','DEP-01','Principal');
set local role authenticated;
select set_config('request.jwt.claim.sub','11800000-0000-0000-0000-000000000001',true);
select public.manage_manual_warehouse('create','MANUAL','Manual');
do $$ begin if not exists (select 1 from public.warehouses where code='MANUAL') then raise exception 'Manual creation failed'; end if; end $$;
select set_config('request.jwt.claim.sub','11800000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error($s$select public.manage_manual_warehouse('create','NOT-ALLOWED','No')$s$, 'TF116');
select public.manage_manual_warehouse('rename','DEP-01','Principal editado');
rollback;
