-- TRZ-100 (1/4): el saldo de stock del ERP deja de ser un pallet.
--
-- Saldo = cuánto hay de un lote en un depósito según el ERP (un número). Pallet = el objeto físico con su QR,
-- que solo conoce TrazFlow (docs/erp-contract.md §4.1). Hasta ahora erp_sync_apply_stock convertía cada saldo
-- en un pallet 'stock:{lote}@{depósito}'. Desde esta migración:
--
--   * los saldos se guardan en erp_stock_balances (solo lectura para la app; los escribe la sincronización);
--   * la sincronización ya no crea ni toca pallets;
--   * cada pallet sabe en qué depósito de TrazFlow está (pallets.warehouse_code).
--
-- Los pallets 'stock:%' que ya existen se conservan tal cual (trazabilidad). El tope de pallets por saldo está
-- en 20261028100300_trz100_erp_stock_cap.sql.
--
-- Depósitos: igual que warehouse_locations y erp_warehouse_mappings (TRZ-96), el depósito de TrazFlow se
-- identifica por (company_id, warehouse_code) en texto. Las tablas y columnas nuevas NO llevan
-- check (warehouse_code = 'DEP-01'): cuando TRZ-101 etapa 2 cree la tabla warehouses, alcanza con agregar la FK.

/* ---------- Helper: cantidad válida para la unidad del producto ---------- */

-- Mismo criterio que isValidQuantity (src/lib/pallets/units.ts): enteras en unidades y cajas, hasta dos
-- decimales en kilogramos. Devuelve el problema en castellano, o null si la cantidad es válida.
-- p_allow_zero: un saldo puede ser 0; una línea de orden o un pallet, no.
create function public.erp_sync_quantity_problem(p_quantity numeric, p_unit text, p_allow_zero boolean)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_quantity is null then 'La cantidad no es un número.'
    when p_quantity < 0 then format('La cantidad %s es negativa.', p_quantity)
    when p_quantity = 0 and not p_allow_zero then 'La cantidad tiene que ser mayor que 0.'
    when p_unit in ('unidades', 'cajas') and p_quantity <> trunc(p_quantity) then
      format('La cantidad %s no es entera y el producto se mide en %s.', p_quantity, p_unit)
    when p_unit = 'kilogramos' and p_quantity <> round(p_quantity, 2) then
      format('La cantidad %s tiene más de dos decimales.', p_quantity)
    else null
  end;
$$;
revoke all on function public.erp_sync_quantity_problem(numeric, text, boolean) from public, anon, authenticated, service_role;

/* ---------- Saldos del ERP ---------- */

create table public.erp_stock_balances (
  company_id uuid not null references public.companies(id) on delete restrict,
  batch_id uuid not null references public.batches(id) on delete restrict,
  -- Depósito tal como lo nombra el ERP.
  external_warehouse_id text not null check (length(btrim(external_warehouse_id)) between 1 and 300),
  -- Depósito de TrazFlow, resuelto con erp_warehouse_mappings al sincronizar.
  warehouse_code text not null check (length(btrim(warehouse_code)) between 1 and 40),
  -- En la unidad del producto (products.unit_of_measure). 0 = el ERP ya no informa saldo.
  quantity numeric not null check (quantity >= 0),
  external_uom text check (external_uom is null or length(btrim(external_uom)) between 1 and 60),
  -- Última sincronización que confirmó este saldo (también cuando pasa a 0). Ver la regla del tope.
  synced_at timestamptz not null default now(),
  -- Última vez que cambió la cantidad.
  quantity_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (company_id, batch_id, external_warehouse_id)
);
create index idx_erp_stock_balances_lot_warehouse
  on public.erp_stock_balances(company_id, batch_id, warehouse_code);

-- Solo lectura para logística y depósito de la empresa. Nadie escribe directo: solo erp_sync_apply_stock.
alter table public.erp_stock_balances enable row level security;
revoke all on public.erp_stock_balances from anon, authenticated, service_role;
grant select on public.erp_stock_balances to authenticated, service_role;
create policy erp_stock_balances_select on public.erp_stock_balances for select to authenticated
  using (
    company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
  );

/* ---------- Depósito de cada pallet ---------- */

-- Backfill: todos los pallets existentes quedan en DEP-01 (el único depósito de hoy). Para los ya entregados
-- significa "depósito de origen". El default es el mismo que usan warehouse_locations y
-- erp_warehouse_mappings (TRZ-96): la app nunca lo elige (no está en los grants de insert ni de update), así
-- que el alta manual y la de pallets contra lotes del ERP quedan siempre en el depósito de la empresa.
alter table public.pallets
  add column warehouse_code text not null default 'DEP-01'
    check (length(btrim(warehouse_code)) between 1 and 40);

-- Un pallet con ubicación física tiene que estar en el depósito de esa ubicación. Se valida con una FK
-- compuesta en vez de un trigger: con MATCH SIMPLE no se verifica mientras current_location_id sea null
-- (pallets sin ubicación o que ya salieron, ver clear_departed_pallet_location).
alter table public.warehouse_locations
  add constraint warehouse_locations_company_id_warehouse_key unique (company_id, id, warehouse_code);
alter table public.pallets
  add constraint pallets_location_warehouse_fkey
  foreign key (company_id, current_location_id, warehouse_code)
  references public.warehouse_locations(company_id, id, warehouse_code) on delete restrict;
create index idx_pallets_lot_warehouse on public.pallets(company_id, batch_id, warehouse_code);

/* ---------- Sincronización de saldos ---------- */

-- La rama de pallets de erp_sync_apply_stock desaparece y, con ella, este helper.
drop function public.erp_sync_pallet_has_history(uuid);

comment on function public.erp_sync_apply_lots(uuid, jsonb) is
  'Lotes del ERP. batches.quantity queda en 0: el saldo de un lote del ERP está en erp_stock_balances (TRZ-100), '
  'y los pallets físicos se arman en TrazFlow contra ese saldo.';

-- p_records: la foto COMPLETA de stock [{ productExternalId, lotExternalId, warehouseExternalId, quantity, uom, unit }].
-- Upsert de erp_stock_balances por (empresa, lote, depósito del ERP). No crea ni modifica pallets.
--   * Un saldo que baja a 0 se guarda en 0; uno que deja de venir pasa a 0 (`absent`). Nunca se borra.
--   * synced_at se actualiza en todos los saldos de la empresa, también en los que pasan a 0, salvo los de
--     registros que fallaron en esta corrida: esos no se pudieron confirmar y conservan su synced_at anterior
--     (si no, el tope tomaría por actualizado un saldo viejo, ver 20261028100300).
--   * quantity_changed_at cambia solo si cambia la cantidad.
-- Contadores: received, created, updated, unchanged, failed, absent. `protected` (era de pallets) ya no existe.
create or replace function public.erp_sync_apply_stock(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"failed":0,"absent":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  -- Un registro que falla no actualiza su saldo (ni su synced_at) y, como su clave está en `present`,
  -- tampoco se pone en 0 como ausente.
  present text[];
  rec jsonb;
  ext text;
  existing public.erp_stock_balances;
  v_lot_ext text;
  v_warehouse_ext text;
  v_batch_id uuid;
  v_product_ext text;
  v_product_unit text;
  v_warehouse_code text;
  v_quantity numeric;
  v_uom text;
  v_problem text;
  v_absent integer;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba la lista de saldos de stock.' using errcode = '22023';
  end if;

  -- Claves (lote@depósito) presentes en esta foto, calculadas antes de procesar: un registro que falla no
  -- cuenta como desaparecido.
  select coalesce(array_agg(key), '{}') into present
  from (
    select btrim(value->>'lotExternalId') || '@' || btrim(value->>'warehouseExternalId') as key
    from jsonb_array_elements(p_records)
  ) keys
  where key is not null;

  for rec in select value from jsonb_array_elements(p_records) loop
    counters := public.erp_sync_bump(counters, 'received');
    v_lot_ext := nullif(btrim(rec->>'lotExternalId'), '');
    v_warehouse_ext := nullif(btrim(rec->>'warehouseExternalId'), '');
    ext := v_lot_ext || '@' || v_warehouse_ext;
    begin
      if v_lot_ext is null then
        raise exception 'El saldo del producto % no tiene lote: TrazFlow necesita un lote para armar pallets.', coalesce(rec->>'productExternalId', '(vacío)');
      end if;
      if v_warehouse_ext is null then raise exception 'El saldo no trae depósito.'; end if;
      if ext = any(seen) then raise exception 'El saldo viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;
      if jsonb_typeof(rec->'quantity') is distinct from 'number' then raise exception 'La cantidad no es un número.'; end if;
      v_quantity := (rec->>'quantity')::numeric;
      v_uom := left(nullif(btrim(rec->>'uom'), ''), 60);

      select batch.id, product.external_id, product.unit_of_measure
        into v_batch_id, v_product_ext, v_product_unit
      from public.batches batch
      join public.products product on product.id = batch.product_id
      where batch.company_id = run.company_id and batch.external_id = v_lot_ext;
      if not found then raise exception 'El lote % no está sincronizado en TrazFlow.', v_lot_ext; end if;
      if v_product_ext is distinct from nullif(btrim(rec->>'productExternalId'), '') then
        raise exception 'El lote % no corresponde al producto %.', v_lot_ext, coalesce(rec->>'productExternalId', '(vacío)');
      end if;
      if rec->>'unit' is null then
        raise exception 'La unidad "%" del ERP no tiene equivalente en TrazFlow.', rec->>'uom';
      end if;
      if rec->>'unit' <> v_product_unit then
        raise exception 'El saldo viene en "%" pero el producto se mide en %.', rec->>'uom', v_product_unit;
      end if;
      v_problem := public.erp_sync_quantity_problem(v_quantity, v_product_unit, true);
      if v_problem is not null then raise exception '%', v_problem; end if;

      select warehouse_code into v_warehouse_code from public.erp_warehouse_mappings
        where company_id = run.company_id and external_warehouse_id = v_warehouse_ext;
      if not found then
        raise exception 'El depósito "%" del ERP no tiene correspondencia en TrazFlow. Vinculalo desde Pallets.', v_warehouse_ext;
      end if;

      select * into existing from public.erp_stock_balances
        where company_id = run.company_id and batch_id = v_batch_id and external_warehouse_id = v_warehouse_ext
        for update;
      if not found then
        insert into public.erp_stock_balances
          (company_id, batch_id, external_warehouse_id, warehouse_code, quantity, external_uom, synced_at, quantity_changed_at)
        values (run.company_id, v_batch_id, v_warehouse_ext, v_warehouse_code, v_quantity, v_uom, now(), now());
        outcome := 'created';
      elsif (existing.quantity, existing.warehouse_code, existing.external_uom)
            is distinct from (v_quantity, v_warehouse_code, v_uom) then
        update public.erp_stock_balances
        set quantity = v_quantity,
            warehouse_code = v_warehouse_code,
            external_uom = v_uom,
            synced_at = now(),
            quantity_changed_at = case when existing.quantity <> v_quantity then now() else existing.quantity_changed_at end
        where company_id = existing.company_id and batch_id = existing.batch_id
          and external_warehouse_id = existing.external_warehouse_id;
        outcome := 'updated';
      else
        update public.erp_stock_balances set synced_at = now()
        where company_id = existing.company_id and batch_id = existing.batch_id
          and external_warehouse_id = existing.external_warehouse_id;
        outcome := 'unchanged';
      end if;
      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('stock', ext, err_message, err_constraint);
    end;
  end loop;

  -- Saldos que ya no vienen del ERP: quedan en 0 (no se borran) y se marcan sincronizados.
  with absent as (
    update public.erp_stock_balances balance
    set quantity = 0,
        synced_at = now(),
        quantity_changed_at = case when balance.quantity <> 0 then now() else balance.quantity_changed_at end
    from public.batches batch
    where batch.id = balance.batch_id
      and balance.company_id = run.company_id
      and not ((batch.external_id || '@' || balance.external_warehouse_id) = any(present))
    returning 1
  )
  select count(*) into v_absent from absent;
  counters := jsonb_set(counters, '{absent}', to_jsonb(v_absent));

  perform public.erp_sync_save(run.id, 'stock', counters, errors);
  return counters;
end;
$$;
