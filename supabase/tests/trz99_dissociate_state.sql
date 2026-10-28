-- TRZ-99: estados válidos al asociar y desasociar pallets. Ejecutar sobre una
-- base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/trz99_dissociate_state.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'TRZ-99 test failed: %', message;
  end if;
end;
$$;

-- Ejecuta un statement con el rol y usuario de la API y devuelve true si la
-- base lo rechazó por permisos (RLS, policy o trigger con 42501).
create or replace function pg_temp.rejected(p_user uuid, p_sql text)
returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when insufficient_privilege then
    reset role;
    return true;
  end;
  reset role;
  return false;
end;
$$;

insert into auth.users (id, email)
values
  ('19900000-0000-0000-0000-000000000001', 'trz99-manager@test.local'),
  ('19900000-0000-0000-0000-000000000002', 'trz99-warehouse@test.local'),
  ('19900000-0000-0000-0000-000000000003', 'trz99-driver@test.local');

insert into companies (id, name)
values ('29900000-0000-0000-0000-000000000001', 'TRZ-99 Company');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);

insert into users (id, company_id, name, email, role)
values
  ('19900000-0000-0000-0000-000000000001', '29900000-0000-0000-0000-000000000001', 'Manager', 'trz99-manager@test.local', 'logistics_manager'),
  ('19900000-0000-0000-0000-000000000002', '29900000-0000-0000-0000-000000000001', 'Warehouse', 'trz99-warehouse@test.local', 'warehouse_operator'),
  ('19900000-0000-0000-0000-000000000003', '29900000-0000-0000-0000-000000000001', 'Driver', 'trz99-driver@test.local', 'driver_operator');

insert into distributors (id, company_id, name)
values ('39900000-0000-0000-0000-000000000001', '29900000-0000-0000-0000-000000000001', 'Distributor');

insert into products (id, company_id, sku, name, unit_of_measure)
values ('49900000-0000-0000-0000-000000000001', '29900000-0000-0000-0000-000000000001', 'SKU-99', 'Product', 'unidades');

insert into batches (id, product_id, batch_number, quantity)
values ('59900000-0000-0000-0000-000000000001', '49900000-0000-0000-0000-000000000001', 'LOT-99', 10);

-- 01: assigned, en la orden draft 1 (desasociación válida).
-- 02: delivered / 03: in_transit / 04: in_warehouse sin reservar / 05: received.
-- 06: assigned, sin orden (para el insert en una orden confirmada).
-- 07: in_warehouse, para la asociación normal (reserva + insert).
-- 08: assigned en la orden draft 1, luego forzado a 'delivered'.
-- 09: in_warehouse, para reservar y liberar (rollback de createDispatchOrder).
insert into pallets (id, company_id, batch_id, qr_code, status)
values
  ('69900000-0000-0000-0000-000000000001', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-1', 'assigned'),
  ('69900000-0000-0000-0000-000000000002', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-2', 'delivered'),
  ('69900000-0000-0000-0000-000000000003', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-3', 'in_transit'),
  ('69900000-0000-0000-0000-000000000004', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-4', 'in_warehouse'),
  ('69900000-0000-0000-0000-000000000005', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-5', 'received'),
  ('69900000-0000-0000-0000-000000000006', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-6', 'assigned'),
  ('69900000-0000-0000-0000-000000000007', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-7', 'in_warehouse'),
  ('69900000-0000-0000-0000-000000000008', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-8', 'assigned'),
  ('69900000-0000-0000-0000-000000000009', '29900000-0000-0000-0000-000000000001', '59900000-0000-0000-0000-000000000001', 'TRZ99-9', 'in_warehouse');

-- 1 y 3: draft. 2: confirmed.
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date)
values
  ('79900000-0000-0000-0000-000000000001', '29900000-0000-0000-0000-000000000001', '39900000-0000-0000-0000-000000000001', '19900000-0000-0000-0000-000000000001', 'draft', current_date),
  ('79900000-0000-0000-0000-000000000002', '29900000-0000-0000-0000-000000000001', '39900000-0000-0000-0000-000000000001', '19900000-0000-0000-0000-000000000001', 'confirmed', current_date),
  ('79900000-0000-0000-0000-000000000003', '29900000-0000-0000-0000-000000000001', '39900000-0000-0000-0000-000000000001', '19900000-0000-0000-0000-000000000001', 'draft', current_date);

insert into order_pallets (order_id, pallet_id, expected)
values
  ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000001', true),
  ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000008', true);

-- ============================================================================
-- Alta de asociaciones por la API
-- ============================================================================
select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000002')$q$),
  'insert directo de un pallet delivered debe rechazarse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000003')$q$),
  'insert directo de un pallet in_transit debe rechazarse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000004')$q$),
  'insert directo de un pallet in_warehouse sin reservar debe rechazarse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000005')$q$),
  'insert directo de un pallet received debe rechazarse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000002', '69900000-0000-0000-0000-000000000006')$q$),
  'insert directo en una orden que no está en draft debe rechazarse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000002',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000003', '69900000-0000-0000-0000-000000000006')$q$),
  'un warehouse_operator no debe poder asociar pallets');

-- Asociación normal, como la hacen createDispatchOrder y associatePallets.
select pg_temp.assert_true(
  not pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set status = 'assigned'
       where id = '69900000-0000-0000-0000-000000000007' and status = 'in_warehouse'$q$),
  'la reserva in_warehouse -> assigned debe permitirse');

select pg_temp.assert_true(
  not pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id, expected) values
      ('79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000007', true)$q$),
  'asociar un pallet reservado a una orden draft debe funcionar');

select pg_temp.assert_true(
  exists (
    select 1 from order_pallets
    where order_id = '79900000-0000-0000-0000-000000000001'
      and pallet_id = '69900000-0000-0000-0000-000000000007'
  ),
  'la asociación normal debe quedar registrada');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$insert into order_pallets (order_id, pallet_id) values
      ('79900000-0000-0000-0000-000000000003', '69900000-0000-0000-0000-000000000007')$q$),
  'un pallet ya asociado a otra orden activa no debe poder asociarse de nuevo');

-- ============================================================================
-- Cambios de estado de pallets por la API
-- ============================================================================
select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set status = 'in_warehouse' where id = '69900000-0000-0000-0000-000000000002'$q$),
  'logística no debe poder pasar un pallet delivered a in_warehouse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000002',
    $q$update pallets set status = 'in_warehouse' where id = '69900000-0000-0000-0000-000000000003'$q$),
  'depósito no debe poder pasar un pallet in_transit a in_warehouse');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set status = 'delivered' where id = '69900000-0000-0000-0000-000000000004'$q$),
  'logística no debe poder marcar un pallet como delivered');

select pg_temp.assert_true(
  pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set status = 'in_warehouse' where id = '69900000-0000-0000-0000-000000000007'$q$),
  'un pallet en una orden activa solo vuelve a depósito con dissociate_pallet_from_order');

select pg_temp.assert_true(
  not pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set status = 'assigned' where id = '69900000-0000-0000-0000-000000000009'$q$)
  and not pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set status = 'in_warehouse' where id = '69900000-0000-0000-0000-000000000009'$q$),
  'reservar y liberar un pallet sin orden (rollback de createDispatchOrder) debe permitirse');

select pg_temp.assert_true(
  not pg_temp.rejected('19900000-0000-0000-0000-000000000001',
    $q$update pallets set quantity = 5 where id = '69900000-0000-0000-0000-000000000004'$q$),
  'editar un pallet sin cambiar su estado debe seguir permitido');

select pg_temp.assert_true(
  (select status from pallets where id = '69900000-0000-0000-0000-000000000002') = 'delivered'
  and (select status from pallets where id = '69900000-0000-0000-0000-000000000003') = 'in_transit'
  and (select status from pallets where id = '69900000-0000-0000-0000-000000000004') = 'in_warehouse'
  and (select status from pallets where id = '69900000-0000-0000-0000-000000000007') = 'assigned'
  and (select status from pallets where id = '69900000-0000-0000-0000-000000000009') = 'in_warehouse',
  'los estados rechazados no deben haber cambiado');

-- ============================================================================
-- Desasociación
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', '19900000-0000-0000-0000-000000000001', true);

select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000001'
  )) = 'dissociated',
  'desasociar un pallet assigned debe funcionar');

reset role;

select pg_temp.assert_true(
  (select status from pallets where id = '69900000-0000-0000-0000-000000000001') = 'in_warehouse'
  and not exists (
    select 1 from order_pallets
    where order_id = '79900000-0000-0000-0000-000000000001'
      and pallet_id = '69900000-0000-0000-0000-000000000001'
  )
  and (
    select count(*) from traceability_events
    where order_id = '79900000-0000-0000-0000-000000000001'
      and pallet_id = '69900000-0000-0000-0000-000000000001'
      and event_type = 'pallet_dissociated'
      and details ->> 'qr_code' = 'TRZ99-1'
  ) = 1,
  'la desasociación válida vuelve el pallet a in_warehouse, borra la fila y deja un evento');

-- Estado inconsistente forzado como superusuario (como lo dejaba el bug).
update pallets set status = 'delivered' where id = '69900000-0000-0000-0000-000000000008';

set local role authenticated;
select set_config('request.jwt.claim.sub', '19900000-0000-0000-0000-000000000001', true);

select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000008'
  )) = 'invalid_pallet_state',
  'desasociar un pallet delivered debe devolver invalid_pallet_state');

reset role;

select pg_temp.assert_true(
  (select status from pallets where id = '69900000-0000-0000-0000-000000000008') = 'delivered'
  and exists (
    select 1 from order_pallets
    where order_id = '79900000-0000-0000-0000-000000000001'
      and pallet_id = '69900000-0000-0000-0000-000000000008'
  )
  and not exists (
    select 1 from traceability_events
    where pallet_id = '69900000-0000-0000-0000-000000000008'
  ),
  'una desasociación inválida no cambia el pallet, no borra la fila ni registra eventos');

-- Roles sin permiso.
set local role authenticated;
select set_config('request.jwt.claim.sub', '19900000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000007'
  )) = 'forbidden',
  'warehouse_operator no debe poder desasociar');

select set_config('request.jwt.claim.sub', '19900000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select outcome from dissociate_pallet_from_order(
    '79900000-0000-0000-0000-000000000001', '69900000-0000-0000-0000-000000000007'
  )) = 'forbidden',
  'driver_operator no debe poder desasociar');
reset role;

select pg_temp.assert_true(
  (select status from pallets where id = '69900000-0000-0000-0000-000000000007') = 'assigned',
  'los intentos sin permiso no cambian el pallet');

rollback;
