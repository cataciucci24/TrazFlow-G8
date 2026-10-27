-- TRZ-103: remito firmado por el chofer e informe de entrega al ERP. Ejecutar sobre una base local migrada.
--   * Al cerrar la entrega de una orden del ERP se encola delivery_confirmed con el resultado por pallet.
--   * Una entrega con diferencias queda needsReview; una orden manual no se informa.
--   * Storage: el chofer sube solo a la carpeta de sus órdenes; logística y depósito leen los de su empresa.
--   * register_delivery_receipt valida permisos, ruta, archivo y tope, y encola delivery_receipt_attached.
--   * Los eventos de entrega enviados quedan not_tracked: TRZ-100 no les consulta remito.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-103: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

insert into auth.users (id, email) values
  ('a1030000-0000-0000-0000-000000000001', 'trz103-manager@test.local'),
  ('a1030000-0000-0000-0000-000000000002', 'trz103-warehouse@test.local'),
  ('a1030000-0000-0000-0000-000000000003', 'trz103-driver-1@test.local'),
  ('a1030000-0000-0000-0000-000000000004', 'trz103-driver-2@test.local'),
  ('a1030000-0000-0000-0000-000000000005', 'trz103-warehouse-b@test.local');
insert into companies (id, name) values
  ('a2030000-0000-0000-0000-000000000001', 'TRZ103 A'),
  ('a2030000-0000-0000-0000-000000000002', 'TRZ103 B');
-- TRZ-101: las empresas nuevas no reciben un depósito automático; en el onboarding se carga DEP-01.
insert into public.warehouses (company_id, code, name)
  select id, 'DEP-01', 'Depósito principal' from public.companies c
  where not exists (select 1 from public.warehouses w where w.company_id = c.id);
insert into users (id, company_id, name, email, role) values
  ('a1030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001', 'Logística', 'trz103-manager@test.local', 'logistics_manager'),
  ('a1030000-0000-0000-0000-000000000002', 'a2030000-0000-0000-0000-000000000001', 'Depósito', 'trz103-warehouse@test.local', 'warehouse_operator'),
  ('a1030000-0000-0000-0000-000000000003', 'a2030000-0000-0000-0000-000000000001', 'Chofer Uno', 'trz103-driver-1@test.local', 'driver_operator'),
  ('a1030000-0000-0000-0000-000000000004', 'a2030000-0000-0000-0000-000000000001', 'Chofer Dos', 'trz103-driver-2@test.local', 'driver_operator'),
  ('a1030000-0000-0000-0000-000000000005', 'a2030000-0000-0000-0000-000000000002', 'Depósito B', 'trz103-warehouse-b@test.local', 'warehouse_operator');
insert into distributors (id, company_id, name) values
  ('a3030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001', 'Distribuidora Demo');
insert into products (id, company_id, sku, name, unit_of_measure) values
  ('a4030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001', 'ACE-1L', 'Aceite', 'cajas');
insert into batches (id, product_id, batch_number, quantity) values
  ('a5030000-0000-0000-0000-000000000001', 'a4030000-0000-0000-0000-000000000001', 'L-103', 50);
insert into pallets (id, company_id, batch_id, qr_code, status, current_location, quantity) values
  ('a6030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001', 'a5030000-0000-0000-0000-000000000001', 'PAL-103-A', 'in_transit', 'En tránsito', 10),
  ('a6030000-0000-0000-0000-000000000002', 'a2030000-0000-0000-0000-000000000001', 'a5030000-0000-0000-0000-000000000001', 'PAL-103-B', 'in_transit', 'En tránsito', 10),
  ('a6030000-0000-0000-0000-000000000003', 'a2030000-0000-0000-0000-000000000001', 'a5030000-0000-0000-0000-000000000001', 'PAL-103-C', 'in_transit', 'En tránsito', 10),
  ('a6030000-0000-0000-0000-000000000004', 'a2030000-0000-0000-0000-000000000001', 'a5030000-0000-0000-0000-000000000001', 'PAL-103-D', 'in_transit', 'En tránsito', 10);

-- 01: del ERP, chofer 1. 02: manual, chofer 1. 03: del ERP, chofer 2. 04: del ERP, chofer 1, sin diferencias.
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at, driver_id, external_id, source_system) values
  ('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001', 'a3030000-0000-0000-0000-000000000001', 'a1030000-0000-0000-0000-000000000001', 'confirmed', current_date, now(), 'a1030000-0000-0000-0000-000000000003', 'SO-103', 'erp'),
  ('a7030000-0000-0000-0000-000000000003', 'a2030000-0000-0000-0000-000000000001', 'a3030000-0000-0000-0000-000000000001', 'a1030000-0000-0000-0000-000000000001', 'confirmed', current_date, now(), 'a1030000-0000-0000-0000-000000000004', 'SO-103-OTRO', 'erp'),
  ('a7030000-0000-0000-0000-000000000004', 'a2030000-0000-0000-0000-000000000001', 'a3030000-0000-0000-0000-000000000001', 'a1030000-0000-0000-0000-000000000001', 'confirmed', current_date, now(), 'a1030000-0000-0000-0000-000000000003', 'SO-103-OK', 'erp');
insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at, driver_id) values
  ('a7030000-0000-0000-0000-000000000002', 'a2030000-0000-0000-0000-000000000001', 'a3030000-0000-0000-0000-000000000001', 'a1030000-0000-0000-0000-000000000001', 'confirmed', current_date, now(), 'a1030000-0000-0000-0000-000000000003');
insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by) values
  ('a7030000-0000-0000-0000-000000000001', 'a6030000-0000-0000-0000-000000000001', true, true, now(), 'a1030000-0000-0000-0000-000000000002'),
  ('a7030000-0000-0000-0000-000000000001', 'a6030000-0000-0000-0000-000000000002', true, true, now(), 'a1030000-0000-0000-0000-000000000002'),
  ('a7030000-0000-0000-0000-000000000002', 'a6030000-0000-0000-0000-000000000003', true, true, now(), 'a1030000-0000-0000-0000-000000000002'),
  ('a7030000-0000-0000-0000-000000000004', 'a6030000-0000-0000-0000-000000000004', true, true, now(), 'a1030000-0000-0000-0000-000000000002');

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.order_delivery_receipts', 'insert'), 'los remitos se registran solo vía RPC');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.register_delivery_receipt(uuid, text, text)', 'execute'), 'anon no registra remitos');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.erp_outbox_delivery_payload(uuid)', 'execute'), 'el armado del payload no se expone');
select pg_temp.assert_true((select not public and file_size_limit = 10485760 from storage.buckets where id = 'delivery-receipts'), 'bucket privado de 10 MB');

/* ---------- Entrega confirmada → outbox ---------- */

set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select outcome from confirm_delivery_pallet('a7030000-0000-0000-0000-000000000001', 'PAL-103-A', null)) = 'delivered', 'entrega pallet A');
reset role;
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_events where event_type = 'delivery_confirmed' and aggregate_id = 'a7030000-0000-0000-0000-000000000001'),
  'con pallets pendientes todavía no se informa la entrega');

set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select outcome from confirm_delivery_pallet('a7030000-0000-0000-0000-000000000001', 'PAL-103-B', 'damaged')) = 'delivered', 'pallet B dañado');
select pg_temp.assert_true((select outcome from confirm_delivery_pallet('a7030000-0000-0000-0000-000000000002', 'PAL-103-C', null)) = 'delivered', 'orden manual entregada');
select pg_temp.assert_true((select outcome from confirm_delivery_pallet('a7030000-0000-0000-0000-000000000004', 'PAL-103-D', null)) = 'delivered', 'orden sin diferencias');
reset role;

select pg_temp.assert_true(
  (select count(*) from erp_outbox_events where event_type = 'delivery_confirmed' and aggregate_id = 'a7030000-0000-0000-0000-000000000001') = 1,
  'la entrega cerrada de una orden del ERP queda en el outbox');
select pg_temp.assert_true(
  (select idempotency_key = 'delivery:SO-103'
      and payload->>'idempotencyKey' = 'delivery:SO-103'
      and payload->>'dispatchIdempotencyKey' = 'dispatch:SO-103'
      and payload->>'orderExternalId' = 'SO-103'
      and (payload->>'needsReview')::boolean
      and payload->'driver'->>'name' = 'Chofer Uno'
      and jsonb_array_length(payload->'lines') = 2
      and payload->'lines' @> '[{"palletCode": "PAL-103-A", "outcome": "delivered"}, {"palletCode": "PAL-103-B", "outcome": "damaged"}]'
      and payload->'discrepancies' = '[{"palletCode": "PAL-103-B", "type": "damaged"}]'
      and status = 'pending'
      and created_by = 'a1030000-0000-0000-0000-000000000003'
   from erp_outbox_events where idempotency_key = 'delivery:SO-103'),
  'payload con resultado por pallet, diferencias y marcado para revisión');
select pg_temp.assert_true(
  (select not (payload->>'needsReview')::boolean and payload->'discrepancies' = '[]'::jsonb
   from erp_outbox_events where idempotency_key = 'delivery:SO-103-OK'),
  'una entrega sin diferencias no queda para revisión');
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_events where aggregate_id = 'a7030000-0000-0000-0000-000000000002'),
  'una orden manual no se informa al ERP');

/* ---------- Storage ---------- */

set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
insert into storage.objects (bucket_id, name, metadata) values
  ('delivery-receipts', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/remito.jpg',
   '{"mimetype": "image/jpeg", "size": 120000}');
select pg_temp.assert_true(true, 'el chofer sube a la carpeta de su orden');

do $$
begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('delivery-receipts', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000003/ajeno.jpg', '{}');
  raise exception 'TRZ-103: el chofer no puede subir a la orden de otro chofer';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('delivery-receipts', 'a2030000-0000-0000-0000-000000000002/a7030000-0000-0000-0000-000000000001/remito.jpg', '{}');
  raise exception 'TRZ-103: la carpeta de empresa tiene que coincidir con la orden';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('a1030000-0000-0000-0000-000000000002');
do $$
begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('delivery-receipts', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/deposito.jpg', '{}');
  raise exception 'TRZ-103: depósito no sube remitos';
exception when insufficient_privilege then null;
end;
$$;
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id = 'delivery-receipts') = 1, 'depósito lee el remito de su empresa');
select pg_temp.as_user('a1030000-0000-0000-0000-000000000004');
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id = 'delivery-receipts') = 0, 'otro chofer no lee remitos de órdenes ajenas');
select pg_temp.as_user('a1030000-0000-0000-0000-000000000005');
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id = 'delivery-receipts') = 0, 'otra empresa no lee el remito');
reset role;

-- Objetos subidos "por fuera" para probar las validaciones del registro.
insert into storage.objects (bucket_id, name, metadata) values
  ('delivery-receipts', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/notas.txt', '{"mimetype": "text/plain", "size": 10}'),
  ('delivery-receipts', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000002/manual.pdf', '{"mimetype": "application/pdf", "size": 2048}');

/* ---------- register_delivery_receipt ---------- */

set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/remito.jpg', 'remito.jpg')) = 'forbidden',
  'solo el chofer registra remitos');

select pg_temp.as_user('a1030000-0000-0000-0000-000000000004');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/remito.jpg', 'remito.jpg')) = 'forbidden',
  'otro chofer no registra en una orden ajena');

select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000004/remito.jpg', 'remito.jpg')) = 'invalid_input',
  'la ruta tiene que ser de la misma orden');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/x/remito.jpg', 'remito.jpg')) = 'invalid_input',
  'sin subcarpetas');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/no-existe.jpg', 'no-existe.jpg')) = 'file_not_found',
  'el archivo tiene que estar subido');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/notas.txt', 'notas.txt')) = 'invalid_file',
  'solo fotos o PDF');

select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/remito.jpg', 'Remito firmado.jpg')) = 'registered',
  'el chofer registra el remito de una orden ya entregada');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000001', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000001/remito.jpg', 'Remito firmado.jpg')) = 'already_registered',
  'registrar dos veces el mismo archivo no lo duplica');
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000002', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000002/manual.pdf', 'manual.pdf')) = 'registered',
  'una orden manual también guarda su remito');
select pg_temp.assert_true((select count(*) from order_delivery_receipts) = 2, 'el chofer ve sus remitos');

select pg_temp.as_user('a1030000-0000-0000-0000-000000000004');
select pg_temp.assert_true((select count(*) from order_delivery_receipts) = 0, 'otro chofer no ve remitos ajenos');
select pg_temp.as_user('a1030000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select count(*) from order_delivery_receipts) = 2, 'logística ve los remitos de su empresa');
select pg_temp.as_user('a1030000-0000-0000-0000-000000000005');
select pg_temp.assert_true((select count(*) from order_delivery_receipts) = 0, 'otra empresa no ve los remitos');
reset role;

select pg_temp.assert_true(
  (select content_type = 'image/jpeg' and size_bytes = 120000 and file_name = 'Remito firmado.jpg'
   from order_delivery_receipts where order_id = 'a7030000-0000-0000-0000-000000000001'),
  'tipo y tamaño salen del objeto subido');
select pg_temp.assert_true(
  (select count(*) = 1
      and bool_and(event.idempotency_key = 'delivery-receipt:SO-103:' || receipt.id)
      and bool_and(event.payload->>'storagePath' = receipt.storage_path)
      and bool_and(event.payload->>'dispatchIdempotencyKey' = 'dispatch:SO-103')
      and bool_and(event.payload->>'contentType' = 'image/jpeg')
   from erp_outbox_events event
   join order_delivery_receipts receipt on receipt.id = event.aggregate_id
   where event.event_type = 'delivery_receipt_attached'
     and event.company_id = 'a2030000-0000-0000-0000-000000000001'),
  'solo el remito de la orden del ERP se encola para adjuntar');

-- Tope por orden.
insert into storage.objects (bucket_id, name, metadata)
select 'delivery-receipts', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000004/hoja-' || n || '.png', '{"mimetype": "image/png", "size": 500}'
from generate_series(1, 6) n;
set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
select register_delivery_receipt('a7030000-0000-0000-0000-000000000004', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000004/hoja-' || n || '.png', 'hoja.png')
from generate_series(1, 5) n;
select pg_temp.assert_true(
  (select outcome from register_delivery_receipt('a7030000-0000-0000-0000-000000000004', 'a2030000-0000-0000-0000-000000000001/a7030000-0000-0000-0000-000000000004/hoja-6.png', 'hoja.png')) = 'limit_reached',
  'hasta 5 remitos por orden');
reset role;

/* ---------- El chofer manda su entrega (20261028130100) ---------- */

-- Un despacho pendiente de la misma orden: el chofer no lo puede tomar.
insert into erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload)
values ('a2030000-0000-0000-0000-000000000001', 'dispatch_confirmed', 'a7030000-0000-0000-0000-000000000001',
        'dispatch:SO-103', '{"idempotencyKey": "dispatch:SO-103"}');

set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000002');
do $$
begin
  perform * from erp_outbox_driver_claim('a7030000-0000-0000-0000-000000000001');
  raise exception 'TRZ-103: depósito no usa las RPC del chofer';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('a1030000-0000-0000-0000-000000000004');
select pg_temp.assert_true(
  (select count(*) from erp_outbox_driver_claim('a7030000-0000-0000-0000-000000000001')) = 0,
  'otro chofer no toma la entrega de una orden ajena');

select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
create temporary table trz103_claimed on commit drop as
select * from erp_outbox_driver_claim('a7030000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(idempotency_key like 'delivery%') and bool_and(attempts = 1) from trz103_claimed),
  'el chofer toma la entrega y el remito de su orden, nunca el despacho');
select pg_temp.assert_true(
  (select count(*) from erp_outbox_driver_claim('a7030000-0000-0000-0000-000000000001')) = 0,
  'lo que ya está en proceso no se vuelve a tomar');

select pg_temp.as_user('a1030000-0000-0000-0000-000000000004');
select pg_temp.assert_true(
  not erp_outbox_driver_mark_sent((select id from trz103_claimed where idempotency_key = 'delivery:SO-103'), 1, 'X', false),
  'otro chofer no cierra el envío');

select pg_temp.as_user('a1030000-0000-0000-0000-000000000003');
select pg_temp.assert_true(
  erp_outbox_driver_mark_sent((select id from trz103_claimed where idempotency_key = 'delivery:SO-103'), 1, 'MAT-DN-0001', false),
  'el chofer marca enviada su entrega');
select pg_temp.assert_true(
  erp_outbox_driver_mark_failed((select id from trz103_claimed where idempotency_key like 'delivery-receipt:%'), 1, 'not_ready', 'Sin remito todavía', true) = 'pending',
  'una falla reintentable queda pendiente con backoff');
select pg_temp.assert_true(
  (select count(*) from erp_outbox_driver_claim('a7030000-0000-0000-0000-000000000001')) = 0,
  'antes del backoff no se vuelve a tomar');
reset role;

select pg_temp.assert_true(
  (select status = 'sent' and erp_reference = 'MAT-DN-0001' and erp_document_status = 'not_tracked'
   from erp_outbox_events where idempotency_key = 'delivery:SO-103'),
  'la entrega quedó enviada y sin seguimiento de remito');
select pg_temp.assert_true(
  (select status = 'pending' and attempts = 0 from erp_outbox_events where idempotency_key = 'dispatch:SO-103'),
  'el despacho no se tocó');

/* ---------- Seguimiento de remito (TRZ-100) solo para despachos ---------- */

update erp_outbox_events set status = 'sent', sent_at = now(), erp_reference = 'MAT-DN-0001'
where idempotency_key = 'delivery:SO-103';
select pg_temp.assert_true(
  (select erp_document_status = 'not_tracked' from erp_outbox_events where idempotency_key = 'delivery:SO-103'),
  'un evento de entrega enviado no se sigue como remito de despacho');

set local role authenticated;
select pg_temp.as_user('a1030000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  not exists (select 1 from erp_outbox_dispatch_documents_due('a2030000-0000-0000-0000-000000000001') where idempotency_key like 'delivery%'),
  'erp_outbox_dispatch_documents_due no devuelve eventos de entrega');
reset role;

rollback;
