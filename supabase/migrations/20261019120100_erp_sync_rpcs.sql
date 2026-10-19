-- US-ERP-03: RPC de sincronización con el ERP.
-- El servidor de Next pide los datos al ERP (fuera de cualquier transacción) y los aplica con estas
-- funciones, una llamada por entidad. Cada registro se procesa en su propio subbloque (savepoint):
-- si uno falla, el resto sigue y el error queda en erp_sync_runs. Nunca se borra nada local.
--
-- Flujo: erp_sync_start → erp_sync_apply_products → _lots → _stock → _orders → erp_sync_finish.

/* ---------- Helpers internos (sin EXECUTE para la API) ---------- */

-- Suma 1 al contador `key`.
create function public.erp_sync_bump(p_counters jsonb, p_key text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_set(p_counters, array[p_key], to_jsonb(coalesce((p_counters->>p_key)::integer, 0) + 1));
$$;

-- Error auditable de un registro. Traduce las colisiones de unicidad a un mensaje entendible.
create function public.erp_sync_error(p_entity text, p_external_id text, p_message text, p_constraint text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'entity', p_entity,
    'external_id', p_external_id,
    'message', left(case
      when p_constraint = 'products_company_id_sku_key' then
        'Ya existe en TrazFlow otro producto con el mismo SKU (cargado a mano). No se fusionan productos por SKU: resolvelo antes de volver a sincronizar.'
      when p_constraint = 'batches_product_id_batch_number_key' then
        'Ya existe otro lote con ese número para el mismo producto. No se fusionan lotes por número.'
      when p_constraint like '%\_company\_external\_id\_key' then
        'Otro registro de TrazFlow ya usa este identificador externo.'
      else p_message
    end, 300));
$$;

-- Bloquea la ejecución y verifica que la siga quien la inició, con rol y empresa vigentes.
create function public.erp_sync_lock_run(p_run_id uuid)
returns public.erp_sync_runs language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs;
begin
  select * into run from public.erp_sync_runs where id = p_run_id for update;
  if not found or auth.uid() is null or run.triggered_by is distinct from auth.uid()
     or public.auth_role() is distinct from 'logistics_manager'
     or public.auth_company_id() is distinct from run.company_id then
    raise exception 'No tenés permisos sobre esta sincronización.' using errcode = '42501';
  end if;
  if run.status <> 'running' then
    raise exception 'La sincronización ya terminó.' using errcode = '55000';
  end if;
  return run;
end;
$$;

create function public.erp_sync_save(p_run_id uuid, p_entity text, p_counters jsonb, p_errors jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.erp_sync_runs
  set counters = counters || jsonb_build_object(p_entity, p_counters),
      errors = coalesce((
        select jsonb_agg(item.value order by item.position)
        from jsonb_array_elements(errors || p_errors) with ordinality as item(value, position)
        where item.position <= 200), '[]'::jsonb)
  where id = p_run_id;
$$;

-- Fecha operativa de la empresa (misma zona que usa la app para "hoy").
create function public.erp_sync_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

-- Un pallet "tiene historia" si ya participó de la operación: eventos, movimientos u órdenes.
create function public.erp_sync_pallet_has_history(p_pallet_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.traceability_events where pallet_id = p_pallet_id)
      or exists (select 1 from public.movements where pallet_id = p_pallet_id)
      or exists (select 1 from public.order_pallets where pallet_id = p_pallet_id);
$$;

revoke all on function public.erp_sync_bump(jsonb, text) from public, anon, authenticated;
revoke all on function public.erp_sync_error(text, text, text, text) from public, anon, authenticated;
revoke all on function public.erp_sync_lock_run(uuid) from public, anon, authenticated;
revoke all on function public.erp_sync_save(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.erp_sync_today() from public, anon, authenticated;
revoke all on function public.erp_sync_pallet_has_history(uuid) from public, anon, authenticated;

/* ---------- Inicio y fin ---------- */

-- Abre una ejecución. p_actor_id tiene que ser el usuario de la sesión: queda como triggered_by y como
-- created_by de las órdenes que se importen.
create function public.erp_sync_start(p_company_id uuid, p_actor_id uuid, p_provider text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  run_id uuid;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id
     or public.auth_role() is distinct from 'logistics_manager'
     or public.auth_company_id() is distinct from p_company_id then
    raise exception 'Solo logística de la empresa puede sincronizar con el ERP.' using errcode = '42501';
  end if;
  if p_provider is null or length(btrim(p_provider)) not between 1 and 40 then
    raise exception 'Proveedor ERP inválido.' using errcode = '22023';
  end if;

  -- Una sola ejecución por empresa a la vez.
  perform pg_advisory_xact_lock(hashtextextended('erp_sync:' || p_company_id::text, 0));
  update public.erp_sync_runs
  set status = 'failed', finished_at = now(),
      error_message = 'La ejecución quedó interrumpida y se cerró automáticamente.'
  where company_id = p_company_id and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from public.erp_sync_runs where company_id = p_company_id and status = 'running') then
    raise exception 'Ya hay una sincronización con el ERP en curso para tu empresa.' using errcode = '55P03';
  end if;

  insert into public.erp_sync_runs (company_id, triggered_by, provider)
  values (p_company_id, p_actor_id, btrim(p_provider))
  returning id into run_id;
  return run_id;
end;
$$;

-- Cierra la ejecución. p_error es la falla que la cortó (mensaje ya sanitizado), o null.
create function public.erp_sync_finish(p_run_id uuid, p_error text default null)
returns public.erp_sync_runs language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  fatal text := left(nullif(btrim(p_error), ''), 500);
begin
  update public.erp_sync_runs
  set status = case
        when fatal is not null and counters = '{}'::jsonb then 'failed'
        when fatal is not null or jsonb_array_length(errors) > 0 then 'partial'
        else 'success'
      end,
      finished_at = now(),
      error_message = fatal
  where id = run.id
  returning * into run;
  return run;
end;
$$;

/* ---------- Productos ---------- */

-- p_records: [{ externalId, sku, name, uom, unit, active }]. `unit` es la unidad de TrazFlow ya traducida
-- por el servidor (null si `uom` no tiene equivalente).
create function public.erp_sync_apply_products(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"failed":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  rec jsonb;
  ext text;
  existing public.products;
  v_sku text;
  v_name text;
  v_unit text;
  v_active boolean;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba una lista de productos.' using errcode = '22023';
  end if;

  for rec in select value from jsonb_array_elements(p_records) loop
    counters := public.erp_sync_bump(counters, 'received');
    ext := nullif(btrim(rec->>'externalId'), '');
    begin
      if ext is null then raise exception 'El producto no trae externalId.'; end if;
      if ext = any(seen) then raise exception 'El externalId viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;
      v_sku := nullif(btrim(rec->>'sku'), '');
      v_name := nullif(btrim(rec->>'name'), '');
      v_unit := rec->>'unit';
      v_active := coalesce((rec->>'active')::boolean, true);
      if v_sku is null or v_name is null then raise exception 'El producto no trae sku o nombre.'; end if;
      if v_unit is null then
        raise exception 'La unidad "%" del ERP no tiene equivalente en TrazFlow.', rec->>'uom';
      end if;

      select * into existing from public.products
        where company_id = run.company_id and external_id = ext for update;
      if not found then
        insert into public.products (company_id, sku, name, unit_of_measure, external_id, source_system, synced_at, external_active)
        values (run.company_id, v_sku, v_name, v_unit, ext, 'erp', now(), v_active);
        outcome := 'created';
      elsif (existing.sku, existing.name, existing.unit_of_measure, existing.external_active)
            is distinct from (v_sku, v_name, v_unit, v_active) then
        update public.products
        set sku = v_sku, name = v_name, unit_of_measure = v_unit, external_active = v_active, synced_at = now()
        where id = existing.id;
        outcome := 'updated';
      else
        update public.products set synced_at = now() where id = existing.id;
        outcome := 'unchanged';
      end if;
      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('products', ext, err_message, err_constraint);
    end;
  end loop;

  perform public.erp_sync_save(run.id, 'products', counters, errors);
  return counters;
end;
$$;

/* ---------- Lotes ---------- */

-- p_records: [{ externalId, productExternalId, lotNumber, expirationDate, active }].
-- La cantidad del lote queda en 0: el stock real de un lote del ERP son sus pallets importados.
create function public.erp_sync_apply_lots(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"failed":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  rec jsonb;
  ext text;
  existing public.batches;
  v_product_id uuid;
  v_number text;
  v_expiration date;
  v_active boolean;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba una lista de lotes.' using errcode = '22023';
  end if;

  for rec in select value from jsonb_array_elements(p_records) loop
    counters := public.erp_sync_bump(counters, 'received');
    ext := nullif(btrim(rec->>'externalId'), '');
    begin
      if ext is null then raise exception 'El lote no trae externalId.'; end if;
      if ext = any(seen) then raise exception 'El externalId viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;
      v_number := nullif(btrim(rec->>'lotNumber'), '');
      if v_number is null or length(v_number) > 512 then raise exception 'El número de lote falta o es demasiado largo.'; end if;
      if rec->>'expirationDate' is not null and rec->>'expirationDate' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'La fecha de vencimiento "%" no es YYYY-MM-DD.', rec->>'expirationDate';
      end if;
      v_expiration := (rec->>'expirationDate')::date;
      v_active := coalesce((rec->>'active')::boolean, true);

      select id into v_product_id from public.products
        where company_id = run.company_id and external_id = nullif(btrim(rec->>'productExternalId'), '');
      if not found then
        raise exception 'El producto % del lote no está sincronizado en TrazFlow.', coalesce(rec->>'productExternalId', '(vacío)');
      end if;

      select * into existing from public.batches
        where company_id = run.company_id and external_id = ext for update;
      if not found then
        insert into public.batches (product_id, batch_number, expiration_date, quantity, external_id, source_system, synced_at, external_active)
        values (v_product_id, v_number, v_expiration, 0, ext, 'erp', now(), v_active);
        outcome := 'created';
      elsif existing.product_id <> v_product_id then
        raise exception 'El lote ya está asociado a otro producto en TrazFlow; no se reasigna.';
      elsif (existing.batch_number, existing.expiration_date, existing.external_active)
            is distinct from (v_number, v_expiration, v_active) then
        update public.batches
        set batch_number = v_number, expiration_date = v_expiration, external_active = v_active, synced_at = now()
        where id = existing.id;
        outcome := 'updated';
      else
        update public.batches set synced_at = now() where id = existing.id;
        outcome := 'unchanged';
      end if;
      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('lots', ext, err_message, err_constraint);
    end;
  end loop;

  perform public.erp_sync_save(run.id, 'lots', counters, errors);
  return counters;
end;
$$;

/* ---------- Pallets (saldos de stock) ---------- */

-- p_records: la foto COMPLETA de stock [{ productExternalId, lotExternalId, warehouseExternalId, quantity, uom, unit }].
-- Un pallet importado = un saldo (lote × depósito), external_id = 'stock:{lote}@{depósito}'. No es un pallet
-- físico verificado: el QR lo genera TrazFlow y la etiqueta se imprime cuando se prepara físicamente.
-- La cantidad solo se actualiza si el pallet sigue en depósito y sin historia; si no, solo synced_at.
-- Los pallets importados cuyo saldo bajó a 0 o desapareció se dejan como están y se cuentan en `absent`.
create function public.erp_sync_apply_stock(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"protected":0,"failed":0,"absent":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  present text[];
  rec jsonb;
  ext text;
  existing public.pallets;
  v_lot_ext text;
  v_warehouse_ext text;
  v_batch_id uuid;
  v_product_ext text;
  v_product_unit text;
  v_warehouse_code text;
  v_quantity numeric;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba la lista de saldos de stock.' using errcode = '22023';
  end if;

  -- Saldos presentes en esta foto (cantidad > 0), calculados antes de procesar: un registro que falla no
  -- cuenta como desaparecido.
  select coalesce(array_agg(id), '{}') into present
  from (
    select 'stock:' || btrim(value->>'lotExternalId') || '@' || btrim(value->>'warehouseExternalId') as id
    from jsonb_array_elements(p_records)
    where jsonb_typeof(value->'quantity') = 'number' and (value->>'quantity')::numeric > 0
  ) ids
  where id is not null;

  for rec in select value from jsonb_array_elements(p_records) loop
    counters := public.erp_sync_bump(counters, 'received');
    v_lot_ext := nullif(btrim(rec->>'lotExternalId'), '');
    v_warehouse_ext := nullif(btrim(rec->>'warehouseExternalId'), '');
    ext := 'stock:' || v_lot_ext || '@' || v_warehouse_ext;
    begin
      if v_lot_ext is null then
        raise exception 'El saldo del producto % no tiene lote: TrazFlow necesita un lote para el pallet.', coalesce(rec->>'productExternalId', '(vacío)');
      end if;
      if v_warehouse_ext is null then raise exception 'El saldo no trae depósito.'; end if;
      if ext = any(seen) then raise exception 'El saldo viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;
      if jsonb_typeof(rec->'quantity') is distinct from 'number' then raise exception 'La cantidad no es un número.'; end if;
      v_quantity := (rec->>'quantity')::numeric;
      if v_quantity <= 0 then
        -- Saldo en 0: no se toca el pallet; se cuenta como ausente al final.
        continue;
      end if;

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
      if v_product_unit in ('unidades', 'cajas') and v_quantity <> trunc(v_quantity) then
        raise exception 'La cantidad % no es entera y el producto se mide en %.', v_quantity, v_product_unit;
      end if;
      if v_product_unit = 'kilogramos' and v_quantity <> round(v_quantity, 2) then
        raise exception 'La cantidad % tiene más de dos decimales.', v_quantity;
      end if;

      select warehouse_code into v_warehouse_code from public.erp_warehouse_mappings
        where company_id = run.company_id and external_warehouse_id = v_warehouse_ext;
      if not found then
        raise exception 'El depósito "%" del ERP no tiene correspondencia en TrazFlow. Vinculalo desde Pallets.', v_warehouse_ext;
      end if;

      select * into existing from public.pallets
        where company_id = run.company_id and external_id = ext for update;
      if not found then
        insert into public.pallets (company_id, batch_id, quantity, current_location, external_id, source_system, synced_at)
        values (run.company_id, v_batch_id, v_quantity, v_warehouse_code, ext, 'erp', now());
        outcome := 'created';
      elsif existing.status <> 'in_warehouse' or public.erp_sync_pallet_has_history(existing.id) then
        update public.pallets set synced_at = now() where id = existing.id;
        outcome := 'protected';
      elsif existing.quantity is distinct from v_quantity then
        update public.pallets set quantity = v_quantity, synced_at = now() where id = existing.id;
        outcome := 'updated';
      else
        update public.pallets set synced_at = now() where id = existing.id;
        outcome := 'unchanged';
      end if;
      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('stock', ext, err_message, err_constraint);
    end;
  end loop;

  counters := jsonb_set(counters, '{absent}', to_jsonb((
    select count(*) from public.pallets
    where company_id = run.company_id and source_system = 'erp' and not (external_id = any(present)))));

  perform public.erp_sync_save(run.id, 'stock', counters, errors);
  return counters;
end;
$$;

/* ---------- Órdenes de despacho (solo cabecera) ---------- */

-- p_records: [{ externalId, status, customer: { externalId, name }, scheduledDate }].
-- El cliente del ERP se guarda como distribuidora (upsert por su externalId). Una orden nueva entra en
-- borrador; una existente solo se actualiza si sigue en borrador. El progreso local nunca se pisa.
create function public.erp_sync_apply_orders(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"updated":0,"unchanged":0,"protected":0,"skipped":0,"failed":0,"customers_created":0,"customers_updated":0}';
  errors jsonb := '[]';
  seen text[] := '{}';
  rec jsonb;
  ext text;
  existing public.dispatch_orders;
  v_exists boolean;
  customer public.distributors;
  v_customer_ext text;
  v_customer_name text;
  v_distributor_id uuid;
  v_date date;
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
        values (run.company_id, v_distributor_id, run.triggered_by, 'draft', v_date, ext, 'erp', now());
        outcome := 'created';
      elsif (existing.distributor_id, existing.estimated_dispatch_date) is distinct from (v_distributor_id, v_date) then
        update public.dispatch_orders
        set distributor_id = v_distributor_id, estimated_dispatch_date = v_date, synced_at = now()
        where id = existing.id;
        outcome := 'updated';
      else
        update public.dispatch_orders set synced_at = now() where id = existing.id;
        outcome := 'unchanged';
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

revoke all on function public.erp_sync_start(uuid, uuid, text) from public, anon;
revoke all on function public.erp_sync_finish(uuid, text) from public, anon;
revoke all on function public.erp_sync_apply_products(uuid, jsonb) from public, anon;
revoke all on function public.erp_sync_apply_lots(uuid, jsonb) from public, anon;
revoke all on function public.erp_sync_apply_stock(uuid, jsonb) from public, anon;
revoke all on function public.erp_sync_apply_orders(uuid, jsonb) from public, anon;
grant execute on function public.erp_sync_start(uuid, uuid, text) to authenticated;
grant execute on function public.erp_sync_finish(uuid, text) to authenticated;
grant execute on function public.erp_sync_apply_products(uuid, jsonb) to authenticated;
grant execute on function public.erp_sync_apply_lots(uuid, jsonb) to authenticated;
grant execute on function public.erp_sync_apply_stock(uuid, jsonb) to authenticated;
grant execute on function public.erp_sync_apply_orders(uuid, jsonb) to authenticated;
