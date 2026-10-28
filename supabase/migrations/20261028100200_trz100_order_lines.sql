-- TRZ-100 (3/4): líneas de las órdenes del ERP y la línea en el reporte de despacho.
--
-- El contrato siempre trajo lines[] (ErpDispatchOrderLine), pero las órdenes se importaban solo con la
-- cabecera. Ahora se guardan en dispatch_order_lines para comparar lo pedido con lo armado (solo un aviso, no
-- bloquea) y para informar orderLineExternalId en el reporte.

create table public.dispatch_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  -- Las líneas son un espejo de la orden del ERP: si la orden se borra, se van con ella.
  order_id uuid not null references public.dispatch_orders(id) on delete cascade,
  external_id text not null check (length(btrim(external_id)) between 1 and 300),
  product_id uuid not null references public.products(id) on delete restrict,
  -- En la unidad del producto (products.unit_of_measure).
  quantity numeric not null check (quantity > 0),
  external_uom text check (external_uom is null or length(btrim(external_uom)) between 1 and 60),
  external_warehouse_id text check (external_warehouse_id is null or length(btrim(external_warehouse_id)) between 1 and 300),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint dispatch_order_lines_order_external_key unique (order_id, external_id)
);
create index idx_dispatch_order_lines_order_product on public.dispatch_order_lines(order_id, product_id);
create index idx_dispatch_order_lines_company on public.dispatch_order_lines(company_id);

-- Misma visibilidad que dispatch_orders (orders_select): logística y depósito de la empresa, y el chofer de
-- las órdenes que tiene asignadas. Nadie escribe directo: solo erp_sync_apply_orders.
alter table public.dispatch_order_lines enable row level security;
revoke all on public.dispatch_order_lines from anon, authenticated, service_role;
grant select on public.dispatch_order_lines to authenticated, service_role;
create policy dispatch_order_lines_select on public.dispatch_order_lines for select to authenticated
  using (
    ((select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
      and company_id = (select public.auth_company_id()))
    or ((select public.auth_role()) = 'driver_operator'
      and exists (
        select 1 from public.dispatch_orders orders
        where orders.id = dispatch_order_lines.order_id and orders.driver_id = (select auth.uid())))
  );

/* ---------- Sincronización de órdenes, ahora con líneas ---------- */

-- Igual que en 20261019120100_erp_sync_rpcs.sql, más las líneas.
-- p_records: [{ externalId, status, customer: { externalId, name }, scheduledDate,
--               lines: [{ externalId, productExternalId, quantity, uom, unit, warehouseExternalId }] }].
-- `unit` es la unidad de TrazFlow ya traducida por el servidor (null si `uom` no tiene equivalente).
--
-- Líneas:
--   * Solo se crean o actualizan mientras la orden está en borrador. En ese estado son un espejo del ERP:
--     las que dejan de venir se borran. Con la orden en cualquier otro estado no se tocan (`protected`).
--   * Una línea con producto no sincronizado, unidad distinta de la del producto o cantidad inválida para esa
--     unidad rechaza la orden entera (error auditado, contador `failed`), igual que una orden sin líneas: no
--     se importa una orden que después no se podría comparar ni reportar bien.
--   * Un cambio solo en las líneas cuenta como `updated`.
create or replace function public.erp_sync_apply_orders(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"protected":0,"skipped":0,"failed":0,"customers_created":0,"customers_updated":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  rec jsonb;
  line jsonb;
  ext text;
  existing public.dispatch_orders;
  v_exists boolean;
  customer public.distributors;
  v_customer_ext text;
  v_customer_name text;
  v_distributor_id uuid;
  v_order_id uuid;
  v_date date;
  v_lines jsonb;
  v_line_ids text[];
  v_line_ext text;
  v_line_product_ext text;
  v_line_product_id uuid;
  v_line_product_unit text;
  v_line_quantity numeric;
  v_problem text;
  v_lines_before jsonb;
  v_lines_after jsonb;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba una lista de órdenes.' using errcode = '22023';
  end if;

  for rec in select value from jsonb_array_elements(p_records) loop
    counters := public.erp_sync_bump(counters, 'received');
    ext := nullif(btrim(rec->>'externalId'), '');
    begin
      if ext is null then raise exception 'La orden no trae externalId.'; end if;
      if ext = any(seen) then raise exception 'El externalId viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;

      select * into existing from public.dispatch_orders
        where company_id = run.company_id and external_id = ext for update;
      v_exists := found;

      if coalesce(rec->>'status', '') not in ('pending', 'partially_delivered', 'delivered', 'cancelled') then
        raise exception 'Estado de orden desconocido: "%".', coalesce(rec->>'status', '(vacío)');
      end if;
      if rec->>'status' not in ('pending', 'partially_delivered') then
        -- Cerrada o cancelada en el ERP: no se crea ni se modifica nada local.
        if v_exists then update public.dispatch_orders set synced_at = now() where id = existing.id; end if;
        counters := public.erp_sync_bump(counters, 'skipped');
        continue;
      end if;

      if rec->>'scheduledDate' is not null and rec->>'scheduledDate' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'La fecha prevista "%" no es YYYY-MM-DD.', rec->>'scheduledDate';
      end if;
      v_date := coalesce((rec->>'scheduledDate')::date, public.erp_sync_today());

      if v_exists and existing.status <> 'draft' then
        update public.dispatch_orders set synced_at = now() where id = existing.id;
        counters := public.erp_sync_bump(counters, 'protected');
        continue;
      end if;

      -- Líneas: se validan todas antes de tocar nada.
      if jsonb_typeof(rec->'lines') is distinct from 'array' or jsonb_array_length(rec->'lines') = 0 then
        raise exception 'La orden no trae líneas: no se importa.';
      end if;
      v_lines := '[]';
      v_line_ids := '{}';
      for line in select value from jsonb_array_elements(rec->'lines') loop
        v_line_ext := nullif(btrim(line->>'externalId'), '');
        if v_line_ext is null then raise exception 'Una línea de la orden no trae externalId.'; end if;
        if v_line_ext = any(v_line_ids) then raise exception 'La línea % viene repetida.', v_line_ext; end if;
        v_line_ids := v_line_ids || v_line_ext;

        v_line_product_ext := nullif(btrim(line->>'productExternalId'), '');
        select id, unit_of_measure into v_line_product_id, v_line_product_unit
        from public.products
        where company_id = run.company_id and external_id = v_line_product_ext;
        if not found then
          raise exception 'La línea % pide el producto %, que no está sincronizado en TrazFlow.', v_line_ext, coalesce(v_line_product_ext, '(vacío)');
        end if;
        if line->>'unit' is null then
          raise exception 'La línea % viene en "%", que no tiene equivalente en TrazFlow.', v_line_ext, coalesce(line->>'uom', '(vacía)');
        end if;
        if line->>'unit' <> v_line_product_unit then
          raise exception 'La línea % viene en "%" pero el producto se mide en %.', v_line_ext, line->>'uom', v_line_product_unit;
        end if;
        if jsonb_typeof(line->'quantity') is distinct from 'number' then
          raise exception 'La cantidad de la línea % no es un número.', v_line_ext;
        end if;
        v_line_quantity := (line->>'quantity')::numeric;
        v_problem := public.erp_sync_quantity_problem(v_line_quantity, v_line_product_unit, false);
        if v_problem is not null then raise exception 'Línea %: %', v_line_ext, v_problem; end if;

        v_lines := v_lines || jsonb_build_object(
          'external_id', v_line_ext,
          'product_id', v_line_product_id,
          'quantity', v_line_quantity,
          'external_uom', left(nullif(btrim(line->>'uom'), ''), 60),
          'external_warehouse_id', left(nullif(btrim(line->>'warehouseExternalId'), ''), 300));
      end loop;

      v_customer_ext := nullif(btrim(rec->'customer'->>'externalId'), '');
      v_customer_name := nullif(btrim(rec->'customer'->>'name'), '');
      if v_customer_ext is null or v_customer_name is null then
        raise exception 'La orden no trae el cliente (externalId y nombre).';
      end if;
      select * into customer from public.distributors
        where company_id = run.company_id and external_id = v_customer_ext for update;
      if not found then
        insert into public.distributors (company_id, name, external_id, source_system, synced_at)
        values (run.company_id, v_customer_name, v_customer_ext, 'erp', now())
        returning id into v_distributor_id;
        counters := public.erp_sync_bump(counters, 'customers_created');
      else
        v_distributor_id := customer.id;
        if customer.name is distinct from v_customer_name then
          update public.distributors set name = v_customer_name, synced_at = now() where id = customer.id;
          counters := public.erp_sync_bump(counters, 'customers_updated');
        else
          update public.distributors set synced_at = now() where id = customer.id;
        end if;
      end if;

      if not v_exists then
        insert into public.dispatch_orders (company_id, distributor_id, created_by, status, estimated_dispatch_date, external_id, source_system, synced_at)
        values (run.company_id, v_distributor_id, run.triggered_by, 'draft', v_date, ext, 'erp', now())
        returning id into v_order_id;
        outcome := 'created';
      elsif (existing.distributor_id, existing.estimated_dispatch_date) is distinct from (v_distributor_id, v_date) then
        v_order_id := existing.id;
        update public.dispatch_orders
        set distributor_id = v_distributor_id, estimated_dispatch_date = v_date, synced_at = now()
        where id = existing.id;
        outcome := 'updated';
      else
        v_order_id := existing.id;
        update public.dispatch_orders set synced_at = now() where id = existing.id;
        outcome := 'unchanged';
      end if;

      -- Espejo de las líneas (la orden está en borrador).
      select coalesce(jsonb_agg(jsonb_build_array(external_id, product_id, quantity, external_uom, external_warehouse_id) order by external_id), '[]')
        into v_lines_before
      from public.dispatch_order_lines where order_id = v_order_id;

      delete from public.dispatch_order_lines
      where order_id = v_order_id and not (external_id = any(v_line_ids));
      insert into public.dispatch_order_lines
        (company_id, order_id, external_id, product_id, quantity, external_uom, external_warehouse_id, synced_at)
      select run.company_id, v_order_id, item.external_id, item.product_id, item.quantity, item.external_uom,
             item.external_warehouse_id, now()
      from jsonb_to_recordset(v_lines) as item(
        external_id text, product_id uuid, quantity numeric, external_uom text, external_warehouse_id text)
      on conflict (order_id, external_id) do update
      set product_id = excluded.product_id,
          quantity = excluded.quantity,
          external_uom = excluded.external_uom,
          external_warehouse_id = excluded.external_warehouse_id,
          synced_at = excluded.synced_at;

      select coalesce(jsonb_agg(jsonb_build_array(external_id, product_id, quantity, external_uom, external_warehouse_id) order by external_id), '[]')
        into v_lines_after
      from public.dispatch_order_lines where order_id = v_order_id;
      if outcome = 'unchanged' and v_lines_before is distinct from v_lines_after then
        outcome := 'updated';
      end if;

      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('orders', ext, err_message, err_constraint);
    end;
  end loop;

  perform public.erp_sync_save(run.id, 'orders', counters, errors);
  return counters;
end;
$$;

/* ---------- Reporte de despacho con la línea de la orden ---------- */

-- Igual que en 20261019140000_erp_dispatch_outbox.sql, más orderLineExternalId: la línea de la orden que pide
-- ese producto, si hay exactamente una. Con dos o más líneas del mismo producto va null (TrazFlow no reparte
-- un pallet entre líneas); el adaptador de ERPNext usa entonces la primera línea del producto. La cantidad
-- sigue siendo la real de cada pallet.
create or replace function public.erp_outbox_dispatch_payload(p_order_id uuid, p_operator_id uuid, p_dispatched_at timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contractVersion', 1,
    'idempotencyKey', 'dispatch:' || btrim(orders.external_id),
    'orderExternalId', btrim(orders.external_id),
    'dispatchedAt', to_char(p_dispatched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operator', jsonb_build_object('id', operator.id, 'name', operator.name),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'orderLineExternalId', (
            select min(order_line.external_id)
            from public.dispatch_order_lines order_line
            where order_line.order_id = orders.id and order_line.product_id = product.id
            having count(*) = 1),
          'palletCode', pallet.qr_code,
          'productExternalId', product.external_id,
          'lotExternalId', batch.external_id,
          'quantity', pallet.quantity,
          'uom', coalesce(product.external_uom, public.erp_outbox_default_uom(product.unit_of_measure))
        ) order by pallet.qr_code)
      from public.order_pallets relation
      join public.pallets pallet on pallet.id = relation.pallet_id
      join public.batches batch on batch.id = pallet.batch_id
      join public.products product on product.id = batch.product_id
      where relation.order_id = orders.id and relation.expected = true
    ), '[]'::jsonb))
  from public.dispatch_orders orders
  join public.users operator on operator.id = p_operator_id
  where orders.id = p_order_id;
$$;
