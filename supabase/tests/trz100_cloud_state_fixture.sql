-- TRZ-100: réplica local del estado de "TrazFlow Demo" en la nube, revisado con select el 27/10/2026.
--
-- NO es un test autocontenido: deja los datos COMMITEADOS para poder aplicar después las migraciones de TRZ-100
-- encima. Va sobre una base local migrada SOLO hasta 20261027120000 (la última aplicada en la nube):
--
--   npx supabase db reset --version 20261027120000
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/trz100_cloud_state_fixture.sql
--   npx supabase migration up --local
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/trz100_cloud_state_checks.sql
--   npx supabase db reset            # al terminar, para volver a la base local normal
--
-- Mismos ids, lotes, cantidades, estados, QR y payloads que la nube (todo vino del ERP mock). Los usuarios son
-- otros (mails @replica.test): las contraseñas de la nube no se copian. De la historia del pallet manual
-- LOTE-002 (4 eventos en la nube) se replica solo la asignación de ubicación.
begin;

-- Empresa y usuarios de la réplica.
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'nube-logistica@replica.test'),
  ('d9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', 'nube-deposito@replica.test'),
  ('c1000000-0000-0000-0000-000000000003', 'nube-chofer@replica.test');
insert into companies (id, name) values ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'TrazFlow Demo');
insert into users (id, company_id, name, email, role) values
  ('c1000000-0000-0000-0000-000000000001', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Responsable Logística', 'nube-logistica@replica.test', 'logistics_manager'),
  ('d9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Operador Depósito', 'nube-deposito@replica.test', 'warehouse_operator'),
  ('c1000000-0000-0000-0000-000000000003', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Operador Distribuidor', 'nube-chofer@replica.test', 'driver_operator');

-- Datos manuales (los que la limpieza NO debe tocar).
insert into products (id, company_id, sku, name, unit_of_measure) values
  ('cd8a2358-5d94-4500-9cbe-e96847e387ea', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'SKU-001', 'Semillas', 'cajas');
insert into batches (id, product_id, batch_number, expiration_date, quantity) values
  ('77be9144-2519-4bf3-b5b9-b0b27613d024', 'cd8a2358-5d94-4500-9cbe-e96847e387ea', 'LOTE-002', '2026-10-24', 0);
insert into distributors (company_id, name) values
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Distribuidor Norte'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Distribuidor Sur');
insert into warehouse_locations (id, company_id, code, aisle, rack, level, position) values
  ('2472be8c-3ff0-419a-a200-b209944c40e0', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'DEP01-P01-E01-N01-P01', '01', '01', '01', '01'),
  ('2079cc04-25ee-4940-a248-92fff9675acb', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'DEP01-P01-E01-N01-P02', '01', '01', '01', '02');
insert into pallets (id, company_id, batch_id, qr_code, status, quantity, current_location, current_location_id) values
  ('8d2ce244-4df8-444e-9b2f-1f9dd2749f5b', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', '77be9144-2519-4bf3-b5b9-b0b27613d024',
   'PAL-25be0a83-13e3-4374-80b1-88f4113a0a8d', 'in_warehouse', 35, 'DEP-01 / DEP01-P01-E01-N01-P02', '2079cc04-25ee-4940-a248-92fff9675acb');

-- Lo importado del ERP mock.
insert into products (id, company_id, sku, name, unit_of_measure, external_uom, external_id, source_system, synced_at, external_active) values
  ('ef3c662e-b5b2-4470-861f-2f2d93c1738a', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ACE-500', 'Aceite de girasol 500 ml', 'cajas', 'Caja', 'ACE-500', 'erp', '2026-10-20 11:26Z', true),
  ('ee494597-2735-4d32-b52d-e80b634a3fe7', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ARR-1KG', 'Arroz largo fino 1 kg', 'cajas', 'Caja', 'ARR-1KG', 'erp', '2026-10-20 11:26Z', true),
  ('b85b99c2-5892-4929-b0af-146cca9435d9', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'QSO-HORMA', 'Queso en horma', 'kilogramos', 'Kg', 'QSO-HORMA', 'erp', '2026-10-20 11:26Z', true),
  ('c712aee3-eb14-4bb7-b63f-e6785481d52d', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'SAL-FINA', 'Sal fina 500 g', 'unidades', 'Unidad', 'SAL-FINA', 'erp', '2026-10-20 11:26Z', false);
insert into batches (id, product_id, batch_number, expiration_date, quantity, external_id, source_system, synced_at, external_active) values
  ('e3455357-fc63-47fb-9416-8048d9e345b4', 'ef3c662e-b5b2-4470-861f-2f2d93c1738a', 'L-2026-0915', '2027-03-31', 0, 'L-2026-0915', 'erp', '2026-10-20 11:26Z', true),
  ('ccfd65c2-4558-4a59-906b-91c1033db46e', 'ef3c662e-b5b2-4470-861f-2f2d93c1738a', 'L-2026-0921', '2027-04-15', 0, 'L-2026-0921', 'erp', '2026-10-20 11:26Z', true),
  ('ac11c714-6533-4e51-b26d-9a351c812a37', 'ee494597-2735-4d32-b52d-e80b634a3fe7', 'ARR-2026-08', '2027-08-01', 0, 'ARR-2026-08', 'erp', '2026-10-20 11:26Z', true),
  ('f3f5ced3-136e-4c09-8183-e8f84d28db83', 'ee494597-2735-4d32-b52d-e80b634a3fe7', 'ARR-2026-10', '2027-10-01', 0, 'ARR-2026-10', 'erp', '2026-10-20 11:26Z', true),
  ('107a1313-f449-41e9-b2f8-51cb5e218f78', 'b85b99c2-5892-4929-b0af-146cca9435d9', 'QSO-2026-1003', '2026-12-03', 0, 'QSO-2026-1003', 'erp', '2026-10-20 11:26Z', true);
insert into distributors (id, company_id, name, external_id, source_system, synced_at) values
  ('3ddf7159-7082-4278-8de9-ed2dc00f1ecc', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Distribuidora Norte', 'CUST-NORTE', 'erp', '2026-10-20 11:26Z'),
  ('c726ca4d-2eb0-4e4b-b6aa-2e60ccf59438', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Almacén del Sur', 'CUST-SUR', 'erp', '2026-10-20 11:26Z');
-- Los dos vínculos a DEP-01: "Deposito central - erv" es el error de tipeo de TRZ-101.
insert into erp_warehouse_mappings (company_id, external_warehouse_id, created_by) values
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Depósito Central - SRV', 'c1000000-0000-0000-0000-000000000001'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'Deposito central - erv', 'c1000000-0000-0000-0000-000000000001');
insert into erp_sync_runs (company_id, triggered_by, provider, status, started_at, finished_at, counters) values
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'c1000000-0000-0000-0000-000000000001', 'mock', 'success', '2026-10-20 11:26Z', '2026-10-20 11:26:05Z',
   '{"products":{"received":4},"lots":{"received":5},"stock":{"received":5},"orders":{"received":4}}');

-- Un saldo = un pallet (modelo anterior). Estados finales de la nube.
insert into pallets (id, company_id, batch_id, qr_code, status, quantity, current_location, external_id, source_system, synced_at) values
  ('bcf035ab-4753-463a-82a4-1d4b4201ccd5', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'e3455357-fc63-47fb-9416-8048d9e345b4',
   'PAL-48885ae8-9118-4c2b-98ff-4b1ae190b59d', 'in_transit', 120, 'En tránsito', 'stock:L-2026-0915@Depósito Central - SRV', 'erp', '2026-10-20 11:26Z'),
  ('b0298c72-0f8e-4c72-addd-24458856f2e8', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ccfd65c2-4558-4a59-906b-91c1033db46e',
   'PAL-5e2cde30-1b21-45b3-a712-ca29537817be', 'in_transit', 80, 'En tránsito', 'stock:L-2026-0921@Depósito Central - SRV', 'erp', '2026-10-20 11:26Z'),
  ('09086ca1-dcc9-419e-922b-095e20ae6f5b', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ac11c714-6533-4e51-b26d-9a351c812a37',
   'PAL-40b59b01-5952-40f6-8798-bbe316911402', 'delivered', 200, 'Distribuidora Norte', 'stock:ARR-2026-08@Depósito Central - SRV', 'erp', '2026-10-20 11:26Z'),
  ('8b0ef537-aec8-4f51-8830-11d9e346315b', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', '107a1313-f449-41e9-b2f8-51cb5e218f78',
   'PAL-4fac3f8e-c8f4-41f6-926c-2a54ad5c1b51', 'in_transit', 356.5, 'En tránsito', 'stock:QSO-2026-1003@Depósito Central - SRV', 'erp', '2026-10-20 11:26Z'),
  ('2b93f0e3-30ab-425f-8324-69705e0855b6', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'f3f5ced3-136e-4c09-8183-e8f84d28db83',
   'PAL-b411310c-8ff3-407a-a790-18149179157d', 'delivered', 150, 'Almacén del Sur', 'stock:ARR-2026-10@Depósito Central - SRV', 'erp', '2026-10-20 11:26Z');

insert into dispatch_orders (id, company_id, distributor_id, created_by, status, estimated_dispatch_date, confirmed_at, driver_id, delivered_at, external_id, source_system, synced_at, created_at) values
  ('9d575885-995d-4db9-94e5-78672a6e21da', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', '3ddf7159-7082-4278-8de9-ed2dc00f1ecc', 'c1000000-0000-0000-0000-000000000001',
   'confirmed', '2026-10-20', '2026-10-19 18:18:49.153275Z', null, null, 'SAL-ORD-2026-00012', 'erp', '2026-10-20 11:26Z', '2026-10-19 18:08:23Z'),
  ('140f7053-8511-4e77-9d6b-752f21ac2c8d', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'c726ca4d-2eb0-4e4b-b6aa-2e60ccf59438', 'c1000000-0000-0000-0000-000000000001',
   'confirmed', '2026-10-21', '2026-10-19 18:13:24.878613Z', null, null, 'SAL-ORD-2026-00013', 'erp', '2026-10-20 11:26Z', '2026-10-19 18:08:23Z'),
  ('a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', '3ddf7159-7082-4278-8de9-ed2dc00f1ecc', 'c1000000-0000-0000-0000-000000000001',
   'delivered', '2026-10-21', '2026-10-20 03:55:46.859663Z', 'c1000000-0000-0000-0000-000000000003', '2026-10-20 03:57:26.849552Z', 'SAL-ORD-2026-00014', 'erp', '2026-10-20 11:26Z', '2026-10-20 03:44:01Z'),
  ('f003897b-fc3d-4414-a3bc-6434f35e1087', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'c726ca4d-2eb0-4e4b-b6aa-2e60ccf59438', 'c1000000-0000-0000-0000-000000000001',
   'delivered', '2026-10-21', '2026-10-20 11:23:51.758333Z', 'c1000000-0000-0000-0000-000000000003', '2026-10-20 11:24:36.256702Z', 'SAL-ORD-2026-00015', 'erp', '2026-10-20 11:26Z', '2026-10-20 10:45:40Z');

-- 00012 pedía aceite y arroz y salió con queso; 00013 pedía queso y salió con aceite (historia: no se corrige).
insert into order_pallets (order_id, pallet_id, expected, detected_at_dispatch, validated_at, validated_by) values
  ('9d575885-995d-4db9-94e5-78672a6e21da', '8b0ef537-aec8-4f51-8830-11d9e346315b', true, true, '2026-10-19 18:18:37Z', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6'),
  ('140f7053-8511-4e77-9d6b-752f21ac2c8d', 'bcf035ab-4753-463a-82a4-1d4b4201ccd5', true, true, '2026-10-19 18:13:19Z', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6'),
  ('140f7053-8511-4e77-9d6b-752f21ac2c8d', 'b0298c72-0f8e-4c72-addd-24458856f2e8', true, true, '2026-10-19 18:13:07Z', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6'),
  ('a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', '09086ca1-dcc9-419e-922b-095e20ae6f5b', true, true, '2026-10-20 03:55:31Z', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6'),
  ('f003897b-fc3d-4414-a3bc-6434f35e1087', '2b93f0e3-30ab-425f-8324-69705e0855b6', true, true, '2026-10-20 11:23:46Z', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6');

-- Trazabilidad (16 eventos de las órdenes + 1 de ubicación) y movimientos, como en la nube.
select set_config('request.jwt.claim.sub', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', true);
insert into traceability_events (company_id, pallet_id, order_id, event_type, details) values
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'b0298c72-0f8e-4c72-addd-24458856f2e8', '140f7053-8511-4e77-9d6b-752f21ac2c8d', 'pallet_associated', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'bcf035ab-4753-463a-82a4-1d4b4201ccd5', '140f7053-8511-4e77-9d6b-752f21ac2c8d', 'pallet_associated', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'b0298c72-0f8e-4c72-addd-24458856f2e8', '140f7053-8511-4e77-9d6b-752f21ac2c8d', 'qr_scan', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'bcf035ab-4753-463a-82a4-1d4b4201ccd5', '140f7053-8511-4e77-9d6b-752f21ac2c8d', 'qr_scan', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', null, '140f7053-8511-4e77-9d6b-752f21ac2c8d', 'dispatch_confirmed', '{"pallet_count":2}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '8b0ef537-aec8-4f51-8830-11d9e346315b', '9d575885-995d-4db9-94e5-78672a6e21da', 'pallet_associated', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '8b0ef537-aec8-4f51-8830-11d9e346315b', '9d575885-995d-4db9-94e5-78672a6e21da', 'qr_scan', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', null, '9d575885-995d-4db9-94e5-78672a6e21da', 'dispatch_confirmed', '{"pallet_count":1}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '09086ca1-dcc9-419e-922b-095e20ae6f5b', 'a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'pallet_associated', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '09086ca1-dcc9-419e-922b-095e20ae6f5b', null, 'location_assigned', '{"new_location":"DEP-01 / DEP01-P01-E01-N01-P01"}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '09086ca1-dcc9-419e-922b-095e20ae6f5b', 'a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'qr_scan', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', null, 'a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'dispatch_confirmed', '{"pallet_count":1}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '09086ca1-dcc9-419e-922b-095e20ae6f5b', 'a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'delivery_confirmed', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '2b93f0e3-30ab-425f-8324-69705e0855b6', 'f003897b-fc3d-4414-a3bc-6434f35e1087', 'pallet_associated', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '2b93f0e3-30ab-425f-8324-69705e0855b6', 'f003897b-fc3d-4414-a3bc-6434f35e1087', 'qr_scan', '{}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', null, 'f003897b-fc3d-4414-a3bc-6434f35e1087', 'dispatch_confirmed', '{"pallet_count":1}'),
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '2b93f0e3-30ab-425f-8324-69705e0855b6', 'f003897b-fc3d-4414-a3bc-6434f35e1087', 'delivery_confirmed', '{}'),
  -- Pallet manual LOTE-002.
  ('bbbf3870-dedd-4d42-872c-a313f1e9536c', '8d2ce244-4df8-444e-9b2f-1f9dd2749f5b', null, 'location_assigned', '{"new_location":"DEP-01 / DEP01-P01-E01-N01-P02"}');
insert into movements (pallet_id, order_id, origin_location, destination_location, resulting_status, user_id) values
  ('09086ca1-dcc9-419e-922b-095e20ae6f5b', null, 'DEP-01', 'DEP-01 / DEP01-P01-E01-N01-P01', 'assigned', 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6'),
  ('09086ca1-dcc9-419e-922b-095e20ae6f5b', 'a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'En tránsito', 'Distribuidora Norte', 'delivered', 'c1000000-0000-0000-0000-000000000003'),
  ('2b93f0e3-30ab-425f-8324-69705e0855b6', 'f003897b-fc3d-4414-a3bc-6434f35e1087', 'En tránsito', 'Almacén del Sur', 'delivered', 'c1000000-0000-0000-0000-000000000003');

-- Los 4 reportes, enviados al mock con orderLineExternalId null.
create function pg_temp.report(p_order text, p_dispatched text, p_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object('contractVersion', 1, 'idempotencyKey', 'dispatch:' || p_order, 'orderExternalId', p_order,
    'dispatchedAt', p_dispatched, 'operator', '{"id":"d9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6","name":"Operador Depósito"}'::jsonb,
    'lines', p_lines);
$$;
insert into erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, status, attempts, sent_at, erp_reference, erp_duplicate, created_by, created_at) values
  ('685e131a-b474-477e-b63f-356c2b3129e5', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'dispatch_confirmed', '140f7053-8511-4e77-9d6b-752f21ac2c8d', 'dispatch:SAL-ORD-2026-00013',
   pg_temp.report('SAL-ORD-2026-00013', '2026-10-19T18:13:24.878Z', '[
     {"orderLineExternalId":null,"palletCode":"PAL-48885ae8-9118-4c2b-98ff-4b1ae190b59d","productExternalId":"ACE-500","lotExternalId":"L-2026-0915","quantity":120,"uom":"Caja"},
     {"orderLineExternalId":null,"palletCode":"PAL-5e2cde30-1b21-45b3-a712-ca29537817be","productExternalId":"ACE-500","lotExternalId":"L-2026-0921","quantity":80,"uom":"Caja"}]'),
   'sent', 1, '2026-10-19 18:13:26.531704Z', 'MOCK-DN-0001', false, 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', '2026-10-19 18:13:24.878613Z'),
  ('eadf354e-2f2e-4da5-b45c-18c67468c5d2', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'dispatch_confirmed', '9d575885-995d-4db9-94e5-78672a6e21da', 'dispatch:SAL-ORD-2026-00012',
   pg_temp.report('SAL-ORD-2026-00012', '2026-10-19T18:18:49.153Z', '[
     {"orderLineExternalId":null,"palletCode":"PAL-4fac3f8e-c8f4-41f6-926c-2a54ad5c1b51","productExternalId":"QSO-HORMA","lotExternalId":"QSO-2026-1003","quantity":356.5,"uom":"Kg"}]'),
   'sent', 2, '2026-10-20 03:55:47.34779Z', 'MOCK-DN-0001', false, 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', '2026-10-19 18:18:49.153275Z'),
  ('349c4beb-e2fc-48be-9765-fd9ac869c2cd', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'dispatch_confirmed', 'a38bbac0-4c81-4ca2-8c9c-0d33e95506ea', 'dispatch:SAL-ORD-2026-00014',
   pg_temp.report('SAL-ORD-2026-00014', '2026-10-20T03:55:46.859Z', '[
     {"orderLineExternalId":null,"palletCode":"PAL-40b59b01-5952-40f6-8798-bbe316911402","productExternalId":"ARR-1KG","lotExternalId":"ARR-2026-08","quantity":200,"uom":"Caja"}]'),
   'sent', 1, '2026-10-20 03:55:47.399444Z', 'MOCK-DN-0002', false, 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', '2026-10-20 03:55:46.859663Z'),
  ('8fbe3999-5456-4430-8eea-5a47fe5c7b39', 'bbbf3870-dedd-4d42-872c-a313f1e9536c', 'dispatch_confirmed', 'f003897b-fc3d-4414-a3bc-6434f35e1087', 'dispatch:SAL-ORD-2026-00015',
   pg_temp.report('SAL-ORD-2026-00015', '2026-10-20T11:23:51.758Z', '[
     {"orderLineExternalId":null,"palletCode":"PAL-b411310c-8ff3-407a-a790-18149179157d","productExternalId":"ARR-1KG","lotExternalId":"ARR-2026-10","quantity":150,"uom":"Caja"}]'),
   'sent', 1, '2026-10-20 11:23:52.243518Z', 'MOCK-DN-0001', false, 'd9cc2264-ad04-4a63-97a5-0c1c1d9ae5d6', '2026-10-20 11:23:51.758333Z');

commit;
