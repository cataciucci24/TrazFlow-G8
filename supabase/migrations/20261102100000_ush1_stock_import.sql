-- USH1: importar productos, lotes y stock desde una planilla.
--   * Con ERP (p_mode = 'erp'): cada fila es un evento stock_import_requested del outbox. El ERP crea lo que falte y
--     deja el stock en borrador; TrazFlow lo recibe por la sincronización, el ERP sigue siendo la fuente de verdad.
--   * Sin ERP (p_mode = 'manual'): crea en TrazFlow producto y lote si faltan, y un pallet en depósito con la cantidad.
-- La planilla se valida en el servidor (src/lib/stock-import); acá van las reglas contra los datos de la empresa.
begin;
alter table public.erp_outbox_events drop constraint erp_outbox_events_event_type_check;
alter table public.erp_outbox_events add constraint erp_outbox_events_event_type_check
  check (event_type in (
    'dispatch_confirmed', 'delivery_confirmed', 'delivery_receipt_attached',
    'stock_entry_requested', 'pallet_scanned', 'pallet_unscanned', 'stock_import_requested'
  ));

-- Hace idempotente cada fila (reintentar con el mismo request_id no duplica) y detecta reimportaciones de otro archivo.
create table public.stock_import_rows (
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null,
  row_number integer not null check (row_number > 0),
  sku text not null,
  lot text not null,
  warehouse_code text not null,
  pallet_id uuid references public.pallets(id) on delete set null,
  outbox_event_id uuid,
  created_at timestamptz not null default now(),
  primary key (company_id, request_id, row_number)
);
create index stock_import_rows_identity_idx on public.stock_import_rows(company_id, sku, lot, warehouse_code);
alter table public.stock_import_rows enable row level security;
revoke all on public.stock_import_rows from public, anon, authenticated;

-- Un lote por fila, hasta 500 por llamada para no chocar con el statement_timeout de authenticated.
-- Devuelve [{row, status}] con status ok (validación) | imported | ya procesada, o un código de error.
create function public.import_stock_rows(p_request_id uuid, p_mode text, p_dry_run boolean, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_user_name text;
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_row integer;
  v_sku text; v_lot text; v_warehouse text; v_unit text; v_name text;
  v_expiration date; v_quantity numeric;
  v_product public.products%rowtype;
  v_batch public.batches%rowtype;
  v_external_warehouse text;
  v_status text;
  v_id uuid;
  v_key text;
begin
  select u.company_id, u.name into v_company, v_user_name from public.users u
  where u.id = auth.uid() and u.role = 'logistics_manager' and u.revoked_at is null;
  if v_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('erp', 'manual') or p_dry_run is null
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500
     or (not p_dry_run and p_request_id is null) then
    raise exception 'Solicitud de importación inválida' using errcode = '22023';
  end if;
  -- Dos importaciones de la misma empresa a la vez no pueden ver cada una libre el mismo lote.
  if not p_dry_run then perform pg_advisory_xact_lock(hashtextextended('stock_import:' || v_company::text, 0)); end if;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_row := null;
    begin
      v_row := (v_item->>'row')::integer;
      v_sku := btrim(v_item->>'sku'); v_lot := btrim(v_item->>'lot'); v_warehouse := btrim(v_item->>'warehouse');
      v_unit := v_item->>'unit'; v_name := btrim(v_item->>'product');
      v_expiration := (v_item->>'expiration')::date; v_quantity := (v_item->>'quantity')::numeric;
      v_product := null; v_batch := null; v_external_warehouse := null; v_status := null;

      if v_row is null or v_row < 1 or coalesce(v_sku, '') = '' or coalesce(v_lot, '') = '' or coalesce(v_name, '') = ''
         or v_expiration is null or v_quantity is null or v_quantity <= 0
         or v_unit is null or v_unit not in ('unidades', 'cajas', 'kilogramos')
         or (v_unit <> 'kilogramos' and v_quantity <> trunc(v_quantity)) then
        v_status := 'invalid_row';
      end if;

      if v_status is null then
        select * into v_product from public.products where company_id = v_company and sku = v_sku;
        if v_product.id is not null then
          select * into v_batch from public.batches where product_id = v_product.id and batch_number = v_lot;
        end if;
        if p_mode = 'manual' then
          if not exists (select 1 from public.warehouses w where w.company_id = v_company and w.code = v_warehouse and w.active) then
            v_status := 'warehouse_not_found';
          elsif v_product.source_system = 'erp' or v_batch.source_system = 'erp' then
            v_status := 'erp_managed';
          end if;
        else
          select m.external_warehouse_id into v_external_warehouse from public.erp_warehouse_mappings m
          where m.company_id = v_company and m.warehouse_code = v_warehouse
          order by m.external_warehouse_id limit 1;
          if v_external_warehouse is null then v_status := 'warehouse_not_mapped'; end if;
        end if;
      end if;
      if v_status is null and v_product.id is not null and v_product.unit_of_measure <> v_unit then v_status := 'unit_mismatch'; end if;
      if v_status is null and v_batch.id is not null and v_batch.expiration_date is distinct from v_expiration then v_status := 'expiration_mismatch'; end if;

      -- Reintento de esta misma importación: ya está hecha.
      if v_status is null and not p_dry_run and exists (
        select 1 from public.stock_import_rows r
        where r.company_id = v_company and r.request_id = p_request_id and r.row_number = v_row
      ) then v_status := 'imported'; end if;

      -- Volver a subir el archivo duplicaría stock. Un envío rechazado por el ERP o un pallet borrado no cuentan.
      if v_status is null and (
        (v_batch.id is not null and exists (
          select 1 from public.pallets p where p.batch_id = v_batch.id and p.warehouse_code = v_warehouse and p.status = 'in_warehouse'
        ))
        or (v_batch.id is not null and exists (
          select 1 from public.erp_stock_balances s where s.batch_id = v_batch.id and s.warehouse_code = v_warehouse and s.quantity > 0
        ))
        or exists (
          select 1 from public.stock_import_rows r
          left join public.erp_outbox_events e on e.id = r.outbox_event_id
          where r.company_id = v_company and r.sku = v_sku and r.lot = v_lot and r.warehouse_code = v_warehouse
            and ((r.outbox_event_id is not null and e.status <> 'failed') or r.pallet_id is not null)
        )
      ) then v_status := 'already_has_stock'; end if;

      if v_status is null and p_dry_run then v_status := 'ok'; end if;

      if v_status is null then
        v_id := gen_random_uuid();
        if p_mode = 'manual' then
          if v_product.id is null then
            insert into public.products (company_id, sku, name, unit_of_measure)
            values (v_company, v_sku, v_name, v_unit) returning * into v_product;
          end if;
          if v_batch.id is null then
            insert into public.batches (product_id, batch_number, expiration_date, quantity)
            values (v_product.id, v_lot, v_expiration, 0) returning * into v_batch;
          end if;
          insert into public.pallets (id, company_id, batch_id, quantity, current_location, warehouse_code)
          values (v_id, v_company, v_batch.id, v_quantity, 'Depósito', v_warehouse);
          insert into public.stock_import_rows (company_id, request_id, row_number, sku, lot, warehouse_code, pallet_id)
          values (v_company, p_request_id, v_row, v_sku, v_lot, v_warehouse, v_id);
        else
          v_key := 'stock-import:' || p_request_id::text || ':' || v_row;
          insert into public.erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
          values (v_id, v_company, 'stock_import_requested', v_id, v_key, jsonb_build_object(
            'contractVersion', 1,
            'idempotencyKey', v_key,
            'sku', v_sku,
            'productName', v_name,
            'lotNumber', v_lot,
            'expirationDate', v_expiration,
            'warehouseExternalId', v_external_warehouse,
            'quantity', v_quantity,
            'uom', coalesce(v_product.external_uom, public.erp_outbox_default_uom(v_unit)),
            'requestedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'requestedBy', jsonb_build_object('id', auth.uid(), 'name', v_user_name)
          ), auth.uid());
          insert into public.stock_import_rows (company_id, request_id, row_number, sku, lot, warehouse_code, outbox_event_id)
          values (v_company, p_request_id, v_row, v_sku, v_lot, v_warehouse, v_id);
        end if;
        v_status := 'imported';
      end if;
    exception when others then
      -- El bloque revierte solo esta fila: las demás siguen.
      v_status := 'write_failed';
    end;
    v_results := v_results || jsonb_build_object('row', coalesce(v_row, 0), 'status', v_status);
  end loop;
  return v_results;
end;
$$;
revoke all on function public.import_stock_rows(uuid, text, boolean, jsonb) from public, anon;
grant execute on function public.import_stock_rows(uuid, text, boolean, jsonb) to authenticated;

-- Una importación puede dejar miles de eventos: no tienen que demorar despachos ni entregas, que se informan primero.
create or replace function public.erp_outbox_claim(p_limit integer default 10, p_aggregate_id uuid default null)
returns table (id uuid, idempotency_key text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.erp_outbox_actor_company();
begin
  -- Un evento que se interrumpió con los intentos ya agotados no se vuelve a tomar.
  update public.erp_outbox_events event
  set status = 'failed', locked_until = null,
      last_error_code = coalesce(event.last_error_code, 'timeout'),
      last_error = 'Se agotaron los reintentos: el último envío se interrumpió sin respuesta.'
  where event.status = 'processing' and event.locked_until < now()
    and event.attempts >= public.erp_outbox_max_attempts()
    and (v_company is null or event.company_id = v_company);

  return query
  with due as (
    select event.id
    from public.erp_outbox_events event
    where (v_company is null or event.company_id = v_company)
      and (p_aggregate_id is null or event.aggregate_id = p_aggregate_id)
      and ((event.status = 'pending' and event.next_attempt_at <= now())
        or (event.status = 'processing' and event.locked_until < now()))
    order by event.event_type = 'stock_import_requested', event.next_attempt_at, event.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.erp_outbox_events event
  set status = 'processing',
      attempts = event.attempts + 1,
      last_attempt_at = now(),
      locked_until = now() + public.erp_outbox_lease()
  from due
  where event.id = due.id
  returning event.id, event.idempotency_key, event.payload, event.attempts;
end;
$$;
commit;
