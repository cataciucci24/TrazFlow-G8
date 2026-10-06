-- Prueba de integración de US-A1. Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us_a1_reception_discrepancies.sql
-- El archivo instala sus propios fixtures y revierte la transacción al final.
--
-- Casos que cubre la migración 20261001000000:
--   1. recepción con daño: pallet en discrepancy, eventos reception y
--      reception_discrepancy, y orden final received_with_discrepancy.
--   2. pallet ajeno: evento reception_discrepancy y notificación visible para
--      logística, sin mutar el pallet ni marcarlo como recibido.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US-A1 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'manager-a1@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'operator-a1@test.local');
insert into companies (id, name) values ('a2000000-0000-0000-0000-000000000001', 'Company A1');
insert into users (id, company_id, name, email, role) values
  ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Manager', 'manager-a1@test.local', 'logistics_manager'),
  ('a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'Operator', 'operator-a1@test.local', 'distributor_operator');
insert into distributors (id, company_id, name) values ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Distributor A1');
insert into distributor_users (distributor_id, user_id) values ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');
insert into products (id, company_id, sku, name, unit_of_measure) values ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'SKU-A1', 'Product A1', 'unidades');
insert into batches (id, product_id, batch_number, quantity) values ('a5000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'LOT-A1', 2);
insert into pallets (id, company_id, batch_id, qr_code, status, current_location) values
  ('a6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'PAL-A1-EXPECTED', 'in_transit', 'En tránsito'),
  ('a6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'PAL-A1-INTRUDER', 'in_transit', 'En tránsito');
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at)
values ('a7000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'confirmed', current_date, now());
insert into order_pallets (order_id, pallet_id, expected, received)
values ('a7000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', true, false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);

select pg_temp.assert_true(
  (select outcome from receive_order_pallet('a7000000-0000-0000-0000-000000000001', 'PAL-A1-EXPECTED', 'damaged')) = 'received',
  'un pallet esperado dañado debe poder recibirse'
);
select pg_temp.assert_true(
  (select status = 'discrepancy' from pallets where id = 'a6000000-0000-0000-0000-000000000001'),
  'el pallet con diferencia debe quedar en discrepancy'
);
select pg_temp.assert_true(
  (select status = 'received_with_discrepancy' from dispatch_orders where id = 'a7000000-0000-0000-0000-000000000001'),
  'la orden completa con diferencia debe cerrar como received_with_discrepancy'
);
select pg_temp.assert_true(
  (select count(*) from traceability_events where order_id = 'a7000000-0000-0000-0000-000000000001' and event_type = 'reception_discrepancy' and details ->> 'type' = 'damaged') = 1,
  'la diferencia debe generar un evento de trazabilidad'
);
select pg_temp.assert_true(
  (select count(*) from order_notifications where order_id = 'a7000000-0000-0000-0000-000000000001' and event_type = 'reception_reported_discrepancy') = 1,
  'la diferencia informada debe generar una notificación para logística'
);

-- El intento ajeno se prueba sobre una nueva orden confirmada para no tocar la
-- idempotencia de la orden ya cerrada.
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at)
values ('a7000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'confirmed', current_date, now());
select pg_temp.assert_true(
  (select outcome from receive_order_pallet('a7000000-0000-0000-0000-000000000002', 'PAL-A1-INTRUDER', null)) = 'wrong_order',
  'un pallet ajeno debe señalarse como wrong_order'
);
select pg_temp.assert_true(
  (select count(*) from order_notifications where order_id = 'a7000000-0000-0000-0000-000000000002' and event_type = 'reception_wrong_pallet' and pallet_id = 'a6000000-0000-0000-0000-000000000002') = 1,
  'un pallet ajeno debe generar una notificación de recepción'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) from order_notifications where order_id = 'a7000000-0000-0000-0000-000000000002' and event_type = 'reception_wrong_pallet') = 1,
  'logistics_manager debe ver la notificación de recepción'
);

reset role;
rollback;
