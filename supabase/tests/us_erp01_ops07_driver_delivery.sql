-- Integración US-ERP-01 + US-OPS-07. Ejecutar sobre una base local migrada.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'driver delivery test failed: %', message; end if;
end;
$$;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'manager-driver@test.local'),
  ('d1000000-0000-0000-0000-000000000002', 'driver-one@test.local'),
  ('d1000000-0000-0000-0000-000000000003', 'driver-two@test.local');
insert into companies (id, name) values ('d2000000-0000-0000-0000-000000000001', 'Driver Company');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'Manager', 'manager-driver@test.local', 'logistics_manager'),
  ('d1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'Driver One', 'driver-one@test.local', 'driver_operator'),
  ('d1000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000001', 'Driver Two', 'driver-two@test.local', 'driver_operator');
insert into distributors (id, company_id, name) values
  ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'Recipient without account');
insert into products (id, company_id, sku, name, unit_of_measure) values
  ('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'SKU-D', 'Product D', 'cajas');
insert into batches (id, product_id, batch_number, quantity) values
  ('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'LOT-D', 4);
insert into pallets (id, company_id, batch_id, qr_code, status, current_location, quantity) values
  ('d6000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'DRIVER-PALLET-1', 'in_transit', 'En tránsito', 10),
  ('d6000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'DRIVER-PALLET-2', 'in_transit', 'En tránsito', 12),
  ('d6000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'DRIVER-FOREIGN', 'in_transit', 'En tránsito', 5);
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at, driver_id) values
  ('d7000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'confirmed', current_date, now(), 'd1000000-0000-0000-0000-000000000002'),
  ('d7000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'confirmed', current_date, now(), 'd1000000-0000-0000-0000-000000000003');
insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by) values
  ('d7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', true, true, now(), 'd1000000-0000-0000-0000-000000000001'),
  ('d7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000002', true, true, now(), 'd1000000-0000-0000-0000-000000000001'),
  ('d7000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000003', true, true, now(), 'd1000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000002', true);

select pg_temp.assert_true(
  (select count(*) from dispatch_orders) = 1,
  'el chofer debe ver solo su orden asignada'
);
select pg_temp.assert_true(
  (select count(*) from get_order_delivery_pallets('d7000000-0000-0000-0000-000000000002')) = 0,
  'el chofer no debe listar pallets de una orden ajena'
);
select pg_temp.assert_true(
  (select outcome from confirm_delivery_pallet('d7000000-0000-0000-0000-000000000002', 'DRIVER-FOREIGN', null)) = 'forbidden',
  'el chofer no debe confirmar una orden ajena'
);
select pg_temp.assert_true(
  (select outcome from confirm_delivery_pallet('d7000000-0000-0000-0000-000000000001', 'DRIVER-FOREIGN', 'wrong_order')) = 'wrong_order',
  'un QR de otra orden debe registrarse como no correspondiente'
);
select pg_temp.assert_true(
  (select count(*) from delivery_discrepancies where order_id = 'd7000000-0000-0000-0000-000000000001' and discrepancy_type = 'wrong_order') = 1,
  'el QR incorrecto debe dejar evidencia de la diferencia'
);
select pg_temp.assert_true(
  (select outcome from confirm_delivery_pallet('d7000000-0000-0000-0000-000000000001', 'DRIVER-PALLET-1', null)) = 'delivered',
  'el primer pallet debe confirmarse'
);
select pg_temp.assert_true(
  (select status = 'confirmed' from dispatch_orders where id = 'd7000000-0000-0000-0000-000000000001'),
  'la orden debe seguir en tránsito mientras quede un pallet'
);
select pg_temp.assert_true(
  (select outcome from confirm_delivery_pallet('d7000000-0000-0000-0000-000000000001', 'DRIVER-PALLET-1', null)) = 'already_processed',
  'un pallet repetido debe ser idempotente'
);
select pg_temp.assert_true(
  (select count(*) from traceability_events where order_id = 'd7000000-0000-0000-0000-000000000001' and pallet_id = 'd6000000-0000-0000-0000-000000000001' and event_type = 'delivery_confirmed') = 1,
  'la repetición no debe duplicar trazabilidad'
);
select pg_temp.assert_true(
  (select outcome from confirm_delivery_pallet('d7000000-0000-0000-0000-000000000001', 'DRIVER-PALLET-2', 'damaged')) = 'delivered',
  'el pallet dañado debe procesarse con diferencia'
);
select pg_temp.assert_true(
  (select status = 'delivered_with_discrepancy' and delivered_by = 'd1000000-0000-0000-0000-000000000002' and delivered_at is not null
   from dispatch_orders where id = 'd7000000-0000-0000-0000-000000000001'),
  'el último pallet con daño debe cerrar la orden con diferencia'
);
select pg_temp.assert_true(
  (select count(*) from delivery_discrepancies where order_id = 'd7000000-0000-0000-0000-000000000001' and discrepancy_type = 'damaged') = 1,
  'la diferencia debe quedar asociada a orden, pallet y chofer'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
-- La notificación es para logística: la RLS de order_notifications se la oculta al chofer.
select pg_temp.assert_true(
  (select count(*) from order_notifications where order_id = 'd7000000-0000-0000-0000-000000000001' and event_type = 'delivery_closed_with_discrepancy') = 1,
  'logística debe recibir una notificación al cerrar con diferencia'
);
select assign_order_driver('d7000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select driver_id = 'd1000000-0000-0000-0000-000000000002' from dispatch_orders where id = 'd7000000-0000-0000-0000-000000000002'),
  'logística debe poder reasignar una orden a un chofer activo de su empresa'
);

reset role;
rollback;
