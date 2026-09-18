-- Prueba de integración de US6. Ejecutar sobre una base local migrada:
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/us6_receive_order_pallet.sql
-- La transacción se revierte y no deja fixtures persistidos.

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'US6 test failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, email)
values
  ('11000000-0000-0000-0000-000000000001', 'manager-us6@test.local'),
  ('11000000-0000-0000-0000-000000000002', 'warehouse-us6@test.local'),
  ('11000000-0000-0000-0000-000000000003', 'distributor-us6@test.local'),
  ('11000000-0000-0000-0000-000000000004', 'other-distributor-us6@test.local');

insert into companies (id, name)
values
  ('21000000-0000-0000-0000-000000000001', 'US6 Owner Company'),
  ('21000000-0000-0000-0000-000000000002', 'US6 Distributor Company');

insert into users (id, company_id, name, email, role)
values
  ('11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Manager US6', 'manager-us6@test.local', 'logistics_manager'),
  ('11000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'Warehouse US6', 'warehouse-us6@test.local', 'warehouse_operator'),
  ('11000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000002', 'Distributor US6', 'distributor-us6@test.local', 'distributor_operator'),
  ('11000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000002', 'Other Distributor US6', 'other-distributor-us6@test.local', 'distributor_operator');

insert into distributors (id, company_id, name)
values
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Distribuidor Norte'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'Distribuidor Sur');

insert into distributor_users (distributor_id, user_id)
values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003'),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004');

insert into products (id, company_id, sku, name)
values ('41000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'SKU-US6', 'Producto US6');

insert into batches (id, product_id, batch_number, quantity)
values ('51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'LOT-US6', 10);

insert into pallets (id, company_id, batch_id, qr_code, status, current_location)
values
  ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US6-OK', 'in_transit', 'En tránsito'),
  ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US6-WRONG-ORDER', 'in_transit', 'En tránsito'),
  ('61000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US6-DRAFT', 'in_transit', 'En tránsito'),
  ('61000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US6-BAD-STATUS', 'assigned', 'Depósito'),
  ('61000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US6-MULTI-A', 'in_transit', 'En tránsito'),
  ('61000000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'PAL-US6-MULTI-B', 'in_transit', 'En tránsito');

insert into dispatch_orders (
  id, company_id, distributor_id, created_by, status,
  estimated_dispatch_date, confirmed_at
)
values
  ('71000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'confirmed', current_date, now()),
  ('71000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'confirmed', current_date, now()),
  ('71000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'draft', current_date, null),
  ('71000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'confirmed', current_date, now()),
  ('71000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'confirmed', current_date, now());

insert into order_pallets (
  order_id, pallet_id, expected, detected_at_dispatch,
  validated_at, validated_by, received
)
values
  ('71000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', true, true, now(), '11000000-0000-0000-0000-000000000002', false),
  ('71000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', true, true, now(), '11000000-0000-0000-0000-000000000002', false),
  ('71000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000003', true, true, now(), '11000000-0000-0000-0000-000000000002', false),
  ('71000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000004', true, true, now(), '11000000-0000-0000-0000-000000000002', false),
  ('71000000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000005', true, true, now(), '11000000-0000-0000-0000-000000000002', false),
  ('71000000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000006', true, true, now(), '11000000-0000-0000-0000-000000000002', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);

-- El RPC de lectura encapsulado devuelve producto/lote solo para la orden del
-- distribuidor, aunque esos datos pertenezcan a otra compañía.
select pg_temp.assert_true(
  (select count(*) from get_order_pallet_receptions('71000000-0000-0000-0000-000000000001')) = 1,
  'el operador debe listar los pallets esperados de su orden'
);

select pg_temp.assert_true(
  (select product_name = 'Producto US6' and product_sku = 'SKU-US6' and batch_number = 'LOT-US6'
   from get_order_pallet_receptions('71000000-0000-0000-0000-000000000001')),
  'la consulta encapsulada debe resolver producto y lote'
);

-- Camino feliz.
do $$
declare result record;
begin
  select * into result from receive_order_pallet(
    '71000000-0000-0000-0000-000000000001', 'PAL-US6-OK'
  );
  perform pg_temp.assert_true(result.outcome = 'received', 'el pallet correcto debe recibirse');
  perform pg_temp.assert_true(result.registered_at is not null, 'la recepción debe devolver su fecha');
end;
$$;

select pg_temp.assert_true(
  (select received from order_pallets
   where order_id = '71000000-0000-0000-0000-000000000001'
     and pallet_id = '61000000-0000-0000-0000-000000000001'),
  'order_pallets.received debe quedar en true'
);

select pg_temp.assert_true(
  (select status = 'received' and current_location = 'Distribuidor Norte'
   from pallets where id = '61000000-0000-0000-0000-000000000001'),
  'el pallet debe quedar recibido en el distribuidor destino'
);

select pg_temp.assert_true(
  (select count(*) from movements
   where order_id = '71000000-0000-0000-0000-000000000001'
     and pallet_id = '61000000-0000-0000-0000-000000000001'
     and origin_location = 'En tránsito'
     and destination_location = 'Distribuidor Norte'
     and resulting_status = 'received'
     and user_id = '11000000-0000-0000-0000-000000000003') = 1,
  'debe crearse exactamente un movimiento de recepción'
);

select pg_temp.assert_true(
  (select count(*) from traceability_events
   where order_id = '71000000-0000-0000-0000-000000000001'
     and pallet_id = '61000000-0000-0000-0000-000000000001'
     and event_type = 'reception'
     and company_id = '21000000-0000-0000-0000-000000000001'
     and user_id = '11000000-0000-0000-0000-000000000003') = 1,
  'debe crearse exactamente un evento reception'
);

select pg_temp.assert_true(
  (select status = 'received' and received_at is not null
   from dispatch_orders where id = '71000000-0000-0000-0000-000000000001'),
  'recibir el último pallet esperado debe cerrar la orden y completar received_at'
);

-- Idempotencia: el bloqueo de la relación hace que un segundo request vea el
-- received persistido; los índices únicos son la última defensa concurrente.
select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000001', 'PAL-US6-OK'
  )) = 'already_received',
  'un reintento debe devolver already_received'
);

select pg_temp.assert_true(
  (select count(*) from movements
   where order_id = '71000000-0000-0000-0000-000000000001'
     and pallet_id = '61000000-0000-0000-0000-000000000001') = 1,
  'un reintento no debe duplicar el movimiento'
);

select pg_temp.assert_true(
  (select count(*) from traceability_events
   where order_id = '71000000-0000-0000-0000-000000000001'
     and pallet_id = '61000000-0000-0000-0000-000000000001'
     and event_type = 'reception') = 1,
  'un reintento no debe duplicar el evento'
);

select pg_temp.assert_true(
  to_regclass('public.idx_events_single_reception') is not null
  and to_regclass('public.idx_movements_single_reception') is not null,
  'deben existir las restricciones únicas de concurrencia'
);

-- Orden con dos pallets esperados: solo debe cerrarse al recibir el último.
do $$
declare result record;
begin
  select * into result from receive_order_pallet(
    '71000000-0000-0000-0000-000000000005', 'PAL-US6-MULTI-A'
  );
  perform pg_temp.assert_true(result.outcome = 'received', 'el primer pallet de la orden multi debe recibirse');
end;
$$;

select pg_temp.assert_true(
  (select status = 'confirmed' and received_at is null
   from dispatch_orders where id = '71000000-0000-0000-0000-000000000005'),
  'la orden debe seguir confirmed mientras falte recibir un pallet esperado'
);

do $$
declare result record;
begin
  select * into result from receive_order_pallet(
    '71000000-0000-0000-0000-000000000005', 'PAL-US6-MULTI-B'
  );
  perform pg_temp.assert_true(result.outcome = 'received', 'el último pallet de la orden multi debe recibirse');
end;
$$;

select pg_temp.assert_true(
  (select status = 'received' and received_at is not null
   from dispatch_orders where id = '71000000-0000-0000-0000-000000000005'),
  'la orden debe cerrarse al recibir el último pallet esperado'
);

-- Reintento tras el cierre de la orden: debe seguir siendo idempotente y no
-- romperse con invalid_status.
select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000005', 'PAL-US6-MULTI-B'
  )) = 'already_received',
  'un reintento sobre una orden ya recibida debe seguir devolviendo already_received'
);

-- Errores funcionales sin escrituras.
select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000001', 'NO-EXISTE'
  )) = 'pallet_not_found',
  'un QR inexistente debe rechazarse'
);

select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000001', 'PAL-US6-WRONG-ORDER'
  )) = 'wrong_order',
  'un pallet de otra orden debe rechazarse'
);

select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000003', 'PAL-US6-DRAFT'
  )) = 'invalid_status',
  'una orden no confirmada debe rechazarse'
);

select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000004', 'PAL-US6-BAD-STATUS'
  )) = 'invalid_pallet_status',
  'un pallet fuera de tránsito debe rechazarse'
);

select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000001', '   '
  )) = 'invalid_input',
  'un QR vacío debe rechazarse'
);

-- Otros roles no pueden ejecutar la recepción.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000002', 'PAL-US6-WRONG-ORDER'
  )) = 'forbidden',
  'warehouse_operator debe ser rechazado'
);

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000002', 'PAL-US6-WRONG-ORDER'
  )) = 'forbidden',
  'logistics_manager debe ser rechazado'
);

-- Un operador asignado a otro distribuidor no puede leer ni recibir la orden.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  (select outcome from receive_order_pallet(
    '71000000-0000-0000-0000-000000000002', 'PAL-US6-WRONG-ORDER'
  )) = 'forbidden',
  'un operador de otro distribuidor debe ser rechazado'
);

select pg_temp.assert_true(
  (select count(*) from get_order_pallet_receptions('71000000-0000-0000-0000-000000000002')) = 0,
  'un operador de otro distribuidor no debe listar pallets de la orden'
);

-- La actualización directa que antes permitía pallets_update queda cerrada
-- para distributor_operator; solo receive_order_pallet puede mutar el pallet.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);

do $$
declare affected integer;
begin
  update pallets
  set current_location = 'Ubicación no autorizada'
  where id = '61000000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  perform pg_temp.assert_true(affected = 0, 'distributor_operator no debe actualizar pallets directamente');
end;
$$;

-- Los permisos directos que usan US2 y US5 se conservan para los dos roles
-- internos sobre pallets de su compañía.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);

do $$
declare affected integer;
begin
  update pallets
  set current_location = current_location
  where id = '61000000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  perform pg_temp.assert_true(affected = 1, 'logistics_manager debe conservar UPDATE para US2');
end;
$$;

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);

do $$
declare affected integer;
begin
  update pallets
  set current_location = current_location
  where id = '61000000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  perform pg_temp.assert_true(affected = 1, 'warehouse_operator debe conservar UPDATE para US5');
end;
$$;

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
update pallets
set current_location = 'Ubicación no autorizada'
where id = '61000000-0000-0000-0000-000000000002';

select pg_temp.assert_true(
  (select current_location = 'En tránsito'
   from pallets where id = '61000000-0000-0000-0000-000000000002'),
  'distributor_operator no debe actualizar pallets directamente'
);

reset role;
rollback;
