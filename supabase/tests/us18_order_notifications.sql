-- Prueba de integración de US18 (TRZ-20). Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us18_order_notifications.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US18 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('11000000-0000-0000-0000-000000000001', 'warehouse-us18@test.local'),
  ('11000000-0000-0000-0000-000000000002', 'manager-us18@test.local'),
  ('11000000-0000-0000-0000-000000000003', 'distributor-op-us18@test.local'),
  ('11000000-0000-0000-0000-000000000004', 'other-warehouse-us18@test.local');

insert into companies (id, name)
values
  ('21000000-0000-0000-0000-000000000001', 'Company US18 A'),
  ('21000000-0000-0000-0000-000000000002', 'Company US18 B');

insert into users (id, company_id, name, email, role)
values
  ('11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Warehouse', 'warehouse-us18@test.local', 'warehouse_operator'),
  ('11000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'Manager', 'manager-us18@test.local', 'logistics_manager'),
  ('11000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', 'Distributor Op', 'distributor-op-us18@test.local', 'distributor_operator'),
  ('11000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000002', 'Other Warehouse', 'other-warehouse-us18@test.local', 'warehouse_operator');

insert into distributors (id, company_id, name)
values ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Distributor');

insert into products (id, company_id, sku, name)
values ('41000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'SKU-US18', 'Product');

insert into batches (id, product_id, batch_number, quantity)
values ('51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'LOT-US18', 10);

-- Pallet que SÍ pertenece a la orden (para poder disparar missing_pallets sin
-- validarlo), un pallet "intruso" que existe en la empresa pero no está
-- asociado a la orden (para disparar wrong_order al escanearlo), y un
-- segundo pallet en depósito que se asocia a la orden RECIÉN DESPUÉS del
-- primer bloqueo por missing_pallets (para probar que sí puede recurrir con
-- un conjunto distinto, ver nota de dedup en la migración).
insert into pallets (id, company_id, batch_id, qr_code, status)
values
  ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US18-EXPECTED', 'assigned'),
  ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US18-INTRUDER', 'in_warehouse'),
  ('61000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US18-LATECOMER', 'in_warehouse');

insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date)
values ('71000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'draft', current_date);

insert into order_pallets (order_id, pallet_id, expected)
values ('71000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);

-- --- wrong_order: escanear un pallet ajeno a la orden crea la notificación --
do $$
declare result record;
begin
  select * into result from validate_order_pallet(
    '71000000-0000-0000-0000-000000000001', 'PAL-US18-INTRUDER'
  );
  perform pg_temp.assert_true(result.outcome = 'wrong_order', 'escanear un pallet ajeno a la orden debe devolver wrong_order');
end;
$$;

select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_wrong_pallet'
     and pallet_id = '61000000-0000-0000-0000-000000000002') = 1,
  'debe crear exactamente una notificación dispatch_wrong_pallet para el pallet intruso'
);

-- --- missing_pallets: confirmar sin validar el pallet esperado -------------
do $$
declare result record;
begin
  select * into result from confirm_dispatch_order('71000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'missing_pallets', 'no se puede confirmar mientras el pallet esperado siga sin validar');
end;
$$;

select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_missing_pallets') = 1,
  'debe crear exactamente una notificación dispatch_missing_pallets'
);

-- Reintentar el mismo bloqueo no debe duplicar la notificación.
do $$
declare result record;
begin
  select * into result from confirm_dispatch_order('71000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'missing_pallets', 'el reintento debe seguir bloqueado por el mismo motivo');
end;
$$;

select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_missing_pallets') = 1,
  'un reintento del mismo bloqueo no debe duplicar la notificación dispatch_missing_pallets'
);

-- --- missing_pallets SÍ puede recurrir con un conjunto distinto ------------
-- Se asocia un pallet nuevo a la orden (todavía 'draft') y se valida el que
-- faltaba originalmente: el próximo bloqueo por faltantes es por un pallet
-- distinto, así que debe generar una segunda notificación, no reusar la
-- primera. La policy real de insert en order_pallets es
-- order_pallets_insert_manager (US3, 20260831235900_add_pallet_validation.sql):
-- exige auth_role() = 'logistics_manager', no warehouse_operator. Se cambia
-- de usuario para este insert de fixture y se vuelve a warehouse_operator
-- después, que es quien necesita invocar validate_order_pallet /
-- confirm_dispatch_order.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
insert into order_pallets (order_id, pallet_id, expected)
values ('71000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);

do $$
declare result record;
begin
  select * into result from validate_order_pallet(
    '71000000-0000-0000-0000-000000000001', 'PAL-US18-EXPECTED'
  );
  perform pg_temp.assert_true(result.outcome = 'validated', 'debe poder validar el pallet originalmente esperado');

  select * into result from confirm_dispatch_order('71000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true(result.outcome = 'missing_pallets', 'debe seguir bloqueado: ahora falta el pallet recién asociado');
  perform pg_temp.assert_true(result.pallet_count = 1, 'debe informar un solo pallet faltante (el recién asociado)');
end;
$$;

select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_missing_pallets') = 2,
  'un bloqueo por un conjunto de pallets faltantes distinto debe crear una segunda notificación, no reusar la primera'
);

-- Se ordena por `seq` (bigserial), no por created_at: dentro de esta misma
-- transacción de test, now() es constante, así que las dos filas
-- dispatch_missing_pallets empatan en created_at y "order by created_at
-- desc" queda indefinido entre ellas. `seq` sí refleja el orden real de
-- inserción.
select pg_temp.assert_true(
  (select missing_pallet_ids from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001'
     and event_type = 'dispatch_missing_pallets'
   order by seq desc limit 1)
    = array['61000000-0000-0000-0000-000000000003'::uuid],
  'la segunda notificación debe reflejar el nuevo conjunto de pallets faltantes'
);

-- --- visibilidad por rol: logistics_manager ve las mismas notificaciones ---
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001') = 3,
  'logistics_manager debe ver las mismas notificaciones que warehouse_operator'
);

-- --- visibilidad por rol: distributor_operator no ve este log --------------
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001') = 0,
  'distributor_operator no debe ver el log de notificaciones de despacho'
);

-- --- aislamiento entre empresas ---------------------------------------------
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  (select count(*) from order_notifications
   where order_id = '71000000-0000-0000-0000-000000000001') = 0,
  'un warehouse_operator de otra compañía no debe ver las notificaciones de esta orden'
);

-- --- no se puede insertar notificaciones directamente salteando los RPCs ---
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    insert into order_notifications (company_id, order_id, event_type, description)
    values ('21000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'dispatch_wrong_pallet', 'intento manual');
    perform pg_temp.assert_true(false, 'logistics_manager no debería poder insertar notificaciones directamente (solo los RPCs, como warehouse_operator)');
  exception when insufficient_privilege or others then
    null; -- esperado: sin GRANT de insert sobre la tabla, ni RLS llega a evaluarse
  end;
end;
$$;

-- Este es el caso que importa de verdad: un warehouse_operator SÍ pasa el
-- rol que exigía la vieja policy (company_id = auth_company_id() and
-- auth_role() = 'warehouse_operator'), así que una policy de insert basada
-- solo en esas dos condiciones lo dejaría pasar con datos inventados
-- (missing_pallet_ids falso, sin haber llamado a validate_order_pallet ni a
-- confirm_dispatch_order). Con el insert revocado a nivel tabla, ni
-- warehouse_operator puede insertar directo: solo los RPCs SECURITY DEFINER
-- pueden.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    insert into order_notifications (
      company_id, order_id, event_type, description, missing_pallet_ids
    )
    values (
      '21000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000001',
      'dispatch_missing_pallets',
      'intento manual salteando confirm_dispatch_order',
      array['61000000-0000-0000-0000-000000000001'::uuid]
    );
    perform pg_temp.assert_true(false, 'warehouse_operator no debería poder insertar notificaciones directamente, ni siquiera con su propio rol (solo vía los RPCs)');
  exception when insufficient_privilege or others then
    null; -- esperado: sin GRANT de insert sobre la tabla, ni RLS llega a evaluarse
  end;
end;
$$;

reset role;
rollback;
