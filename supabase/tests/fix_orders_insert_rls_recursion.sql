-- Logística crea una orden manual (antes: infinite recursion en las políticas de dispatch_orders) y el chofer
-- sigue viendo solo los distribuidores de sus órdenes. Ejecutar sobre una base local migrada.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'orders insert RLS: %', message; end if;
end;
$$;

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'rls-manager@test.local'),
  ('e1000000-0000-0000-0000-000000000002', 'rls-driver@test.local');
insert into companies (id, name) values ('e2000000-0000-0000-0000-000000000001', 'RLS Company');
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'Logística', 'rls-manager@test.local', 'logistics_manager'),
  ('e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'Chofer', 'rls-driver@test.local', 'driver_operator');
insert into distributors (id, company_id, name) values
  ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'Con orden'),
  ('e3000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'Sin orden');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-000000000001', true);
insert into dispatch_orders (id, company_id, distributor_id, created_by, estimated_dispatch_date)
values ('e7000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
        'e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', current_date);
select pg_temp.assert_true(
  (select count(*) from dispatch_orders where id = 'e7000000-0000-0000-0000-000000000001') = 1,
  'logística crea una orden manual');
reset role;

update dispatch_orders set driver_id = 'e1000000-0000-0000-0000-000000000002'
where id = 'e7000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select array_agg(name) from distributors) = array['Con orden'],
  'el chofer ve solo el distribuidor de su orden');
reset role;

rollback;
