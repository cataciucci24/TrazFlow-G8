-- TRZ-101: las migraciones de depósitos sobre la réplica de "TrazFlow Demo" en la nube.
--
-- La nube (revisada con select el 27/10/2026) está igual que la réplica de TRZ-100 después de sus migraciones:
-- mismos ids, 2 ubicaciones y 6 pallets en DEP-01 (1 ubicado), vínculos "Depósito Central - SRV" (19/10) y
-- "Deposito central - erv" (20/10, error de tipeo) a DEP-01, y ningún saldo en erp_stock_balances. Por eso se
-- reutiliza el fixture de TRZ-100. Pasos (base LOCAL; el reset borra los datos locales):
--
--   npx supabase db reset --version 20261027120000
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/trz100_cloud_state_fixture.sql
--   npx supabase migration up --local
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/trz100_cloud_state_checks.sql
--   docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/trz101_cloud_state_checks.sql
--   npx supabase db reset            # al terminar, para volver a la base local normal
--
-- Este archivo no deja datos: simula la primera sincronización con el mock (Central + Norte) y termina en ROLLBACK.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-101 nube: %', message; end if;
end;
$$;

/* ---------- Después de las migraciones, antes de sincronizar ---------- */

select pg_temp.assert_true(
  (select count(*) from warehouses where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c') = 1
  and exists (select 1 from warehouses where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c'
    and code = 'DEP-01' and source_system = 'trazflow' and external_id is null and active),
  'la empresa tiene un solo depósito, DEP-01, cargado en TrazFlow');
select pg_temp.assert_true(
  not exists (select 1 from erp_warehouse_mappings where external_warehouse_id = 'Deposito central - erv'),
  'el vínculo "Deposito central - erv" se borró');
select pg_temp.assert_true(
  (select count(*) from erp_warehouse_mappings where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c') = 1
  and exists (select 1 from erp_warehouse_mappings where external_warehouse_id = 'Depósito Central - SRV' and warehouse_code = 'DEP-01'),
  'el vínculo de "Depósito Central - SRV" a DEP-01 sigue');
select pg_temp.assert_true(
  (select count(*) from warehouse_locations where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and warehouse_code = 'DEP-01') = 2,
  'las 2 ubicaciones siguen en DEP-01');
select pg_temp.assert_true(
  (select count(*) from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c') = 6
  and not exists (select 1 from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and warehouse_code <> 'DEP-01'),
  'los 6 pallets siguen en DEP-01');
select pg_temp.assert_true(
  exists (select 1 from pallets where id = '8d2ce244-4df8-444e-9b2f-1f9dd2749f5b'
    and current_location_id = '2079cc04-25ee-4940-a248-92fff9675acb' and current_location = 'DEP-01 / DEP01-P01-E01-N01-P02'),
  'el pallet ubicado conserva su ubicación y su texto');
select pg_temp.assert_true(
  (select count(*) from pg_constraint where conname in ('warehouse_locations_warehouse_code_check', 'erp_warehouse_mappings_warehouse_code_check')) = 0
  and (select count(*) from pg_constraint where conname in ('warehouse_locations_warehouse_fkey', 'erp_warehouse_mappings_warehouse_fkey',
    'erp_stock_balances_warehouse_fkey', 'pallets_warehouse_fkey') and convalidated) = 4,
  'los check de DEP-01 se reemplazaron por 4 FKs validadas');

/* ---------- Primera sincronización con el mock (Central + Norte) ---------- */

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

do $$
declare
  run_id uuid := public.erp_sync_start('bbbf3870-dedd-4d42-872c-a313f1e9536c', auth.uid(), 'mock');
  counters jsonb;
  run public.erp_sync_runs;
begin
  counters := public.erp_sync_apply_warehouses(run_id, '[
    {"externalId":"Depósito Central - SRV","name":"Depósito Central","active":true},
    {"externalId":"Depósito Norte - SRV","name":"Depósito Norte","active":true}]');
  perform pg_temp.assert_true(counters = '{"received":2,"created":1,"adopted":1,"merged":0,"updated":0,"unchanged":0,"failed":0,"deactivated":0}',
    'contadores de depósitos: ' || counters::text);

  counters := public.erp_sync_apply_stock(run_id, '[
    {"productExternalId":"ACE-500","lotExternalId":"L-2026-0915","warehouseExternalId":"Depósito Central - SRV","quantity":120,"uom":"Caja","unit":"cajas"},
    {"productExternalId":"ACE-500","lotExternalId":"L-2026-0921","warehouseExternalId":"Depósito Central - SRV","quantity":80,"uom":"Caja","unit":"cajas"},
    {"productExternalId":"ACE-500","lotExternalId":"L-2026-0921","warehouseExternalId":"Depósito Norte - SRV","quantity":30,"uom":"Caja","unit":"cajas"}]');
  perform pg_temp.assert_true((counters->>'created')::int = 3 and (counters->>'failed')::int = 0, 'saldos: ' || counters::text);

  run := public.erp_sync_finish(run_id, null);
  perform pg_temp.assert_true(run.status = 'success', 'la corrida termina success (los avisos no son errores): ' || run.errors::text);
  perform pg_temp.assert_true(jsonb_array_length(run.notices) = 2, 'un aviso por depósito: ' || run.notices::text);
end;
$$;

reset role;

select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and code = 'DEP-01'
    and external_id = 'Depósito Central - SRV' and source_system = 'erp' and name = 'Depósito Central' and synced_at is not null),
  'Central toma el lugar de DEP-01');
select pg_temp.assert_true(
  exists (select 1 from warehouses where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and code = 'DEPOSITO-NORTE'
    and external_id = 'Depósito Norte - SRV' and source_system = 'erp')
  and exists (select 1 from erp_warehouse_mappings where external_warehouse_id = 'Depósito Norte - SRV' and warehouse_code = 'DEPOSITO-NORTE'
    and created_by = 'c1000000-0000-0000-0000-000000000001'),
  'Norte entra como DEPOSITO-NORTE, vinculado, con el actor de la corrida');
select pg_temp.assert_true(
  (select count(*) from erp_stock_balances where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and warehouse_code = 'DEP-01') = 2
  and (select count(*) from erp_stock_balances where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and warehouse_code = 'DEPOSITO-NORTE') = 1,
  'cada saldo queda en su depósito');
select pg_temp.assert_true(
  (select count(*) from warehouse_locations where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and warehouse_code = 'DEP-01') = 2
  and (select count(*) from pallets where company_id = 'bbbf3870-dedd-4d42-872c-a313f1e9536c' and warehouse_code = 'DEP-01') = 6
  and exists (select 1 from pallets where id = '8d2ce244-4df8-444e-9b2f-1f9dd2749f5b' and current_location_id = '2079cc04-25ee-4940-a248-92fff9675acb'),
  'ubicaciones y pallets de DEP-01 intactos después de sincronizar');

-- Con dos depósitos, un pallet nuevo tiene que indicar cuál; con el depósito, el tope por saldo aplica igual.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    insert into public.pallets (company_id, batch_id, quantity)
    values ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ccfd65c2-4558-4a59-906b-91c1033db46e', 10);
    raise exception 'TRZ-101 nube: se armó un pallet sin depósito con dos depósitos';
  exception when sqlstate 'TF111' then null;
  end;
  insert into public.pallets (company_id, batch_id, quantity, warehouse_code)
  values ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ccfd65c2-4558-4a59-906b-91c1033db46e', 30, 'DEPOSITO-NORTE');
  begin
    insert into public.pallets (company_id, batch_id, quantity, warehouse_code)
    values ('bbbf3870-dedd-4d42-872c-a313f1e9536c', 'ccfd65c2-4558-4a59-906b-91c1033db46e', 1, 'DEPOSITO-NORTE');
    raise exception 'TRZ-101 nube: se superó el saldo de Norte';
  exception when sqlstate 'TF100' then null;
  end;
end;
$$;
reset role;

rollback;
