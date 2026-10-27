-- TRZ-101 (2/2): la sincronización trae los depósitos del ERP (ErpMasterData.warehouses).
--
-- erp_sync_apply_warehouses corre antes que productos, lotes, stock y órdenes. Por cada depósito del ERP, por
-- (company_id, external_id):
--
--   1. Ya importado → actualiza nombre y activo.
--   2. Tiene un vínculo de antes (erp_warehouse_mappings, cargado a mano antes de TRZ-101) a un depósito de
--      TrazFlow que todavía no es de ningún depósito del ERP → ese depósito pasa a ser este (conserva su código,
--      sus ubicaciones y sus pallets). Si dos depósitos del ERP estaban vinculados al mismo, gana el vínculo más
--      viejo. Es lo que pasa en la nube: "Depósito Central - SRV" queda como DEP-01.
--   3. Tiene un vínculo de antes a un depósito que ya es de otro depósito del ERP → no se crea otro: sus saldos
--      se siguen sumando ahí, como antes (`merged`).
--   4. Si no → depósito nuevo con un código generado a partir del nombre (erp_warehouse_code) y su vínculo.
--
-- Un depósito cargado a mano en TrazFlow (sin vínculo) nunca se toma como uno del ERP: el sistema no adivina.
-- Los depósitos del ERP que dejan de venir quedan active = false (no se borran). Los avisos de lo que pasó con
-- cada depósito quedan en erp_sync_runs.notices (no son errores: la corrida no queda `partial` por ellos).

/* ---------- Avisos de una corrida ---------- */

-- [{ entity, external_id, message }], igual que errors, hasta 200.
alter table public.erp_sync_runs add column notices jsonb not null default '[]'::jsonb
  check (jsonb_typeof(notices) = 'array');

create function public.erp_sync_save_notices(p_run_id uuid, p_notices jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.erp_sync_runs
  set notices = coalesce((
        select jsonb_agg(item.value order by item.position)
        from jsonb_array_elements(notices || p_notices) with ordinality as item(value, position)
        where item.position <= 200), '[]'::jsonb)
  where id = p_run_id;
$$;
revoke all on function public.erp_sync_save_notices(uuid, jsonb) from public, anon, authenticated;

/* ---------- Código de TrazFlow para un depósito importado ---------- */

-- Legible y estable: el nombre sin tildes, en mayúsculas, con guiones ("Depósito Norte" → "DEPOSITO-NORTE").
-- Si ya existe en la empresa, agrega "-2", "-3"… Se calcula una sola vez, al importarlo: si el ERP renombra el
-- depósito, cambia el nombre y el código queda igual. Cumple el formato de warehouses.code.
create function public.erp_warehouse_code(p_company_id uuid, p_name text)
returns text language plpgsql stable set search_path = '' as $$
declare
  base text;
  candidate text;
  n integer := 1;
begin
  base := upper(translate(coalesce(p_name, ''), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                                               'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'));
  base := btrim(regexp_replace(base, '[^A-Z0-9]+', '-', 'g'), '-');
  base := rtrim(left(base, 36), '-');
  if base = '' then base := 'DEP'; end if;
  candidate := base;
  while exists (select 1 from public.warehouses where company_id = p_company_id and code = candidate) loop
    n := n + 1;
    candidate := rtrim(left(base, 39 - length(n::text)), '-') || '-' || n;
  end loop;
  return candidate;
end;
$$;
revoke all on function public.erp_warehouse_code(uuid, text) from public, anon, authenticated, service_role;

/* ---------- Sincronización de depósitos ---------- */

-- p_records: la lista COMPLETA de depósitos del ERP [{ externalId, name, active }] (sin grupos). Se procesan
-- primero los que tienen un vínculo de antes, del más viejo al más nuevo, para que la regla 2 sea determinista.
-- Contadores: received, created, adopted, merged, updated, unchanged, failed, deactivated.
create function public.erp_sync_apply_warehouses(p_run_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  counters jsonb := '{"received":0,"created":0,"adopted":0,"merged":0,"updated":0,"unchanged":0,"failed":0,"deactivated":0}';
  errors jsonb := '[]';
  notices jsonb := '[]';
  seen text[] := '{}';
  -- Un depósito que falla igual cuenta como presente: no se desactiva por un error de esta corrida.
  present text[];
  rec jsonb;
  ext text;
  existing public.warehouses;
  target public.warehouses;
  v_name text;
  v_active boolean;
  v_code text;
  v_deactivated integer;
  v_gone_notices jsonb;
  outcome text;
  err_message text;
  err_constraint text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Se esperaba una lista de depósitos.' using errcode = '22023';
  end if;

  select coalesce(array_agg(key), '{}') into present
  from (select nullif(btrim(value->>'externalId'), '') as key from jsonb_array_elements(p_records)) keys
  where key is not null;

  for rec in
    select item.value
    from jsonb_array_elements(p_records) with ordinality as item(value, position)
    left join public.erp_warehouse_mappings mapping
      on mapping.company_id = run.company_id and mapping.external_warehouse_id = nullif(btrim(item.value->>'externalId'), '')
    order by mapping.created_at nulls last, mapping.external_warehouse_id, item.position
  loop
    counters := public.erp_sync_bump(counters, 'received');
    ext := nullif(btrim(rec->>'externalId'), '');
    begin
      if ext is null then raise exception 'El depósito no trae externalId.'; end if;
      if length(ext) > 300 then raise exception 'El externalId del depósito es demasiado largo.'; end if;
      if ext = any(seen) then raise exception 'El externalId viene repetido en la respuesta del ERP.'; end if;
      seen := seen || ext;
      v_name := left(coalesce(nullif(btrim(rec->>'name'), ''), ext), 140);
      if jsonb_typeof(rec->'active') is distinct from 'boolean' then
        raise exception 'El depósito no informa si está activo.';
      end if;
      v_active := (rec->>'active')::boolean;

      select * into existing from public.warehouses
        where company_id = run.company_id and external_id = ext for update;
      if found then
        if (existing.name, existing.active) is distinct from (v_name, v_active) then
          update public.warehouses set name = v_name, active = v_active, synced_at = now() where id = existing.id;
          outcome := 'updated';
          if existing.active and not v_active then
            notices := notices || public.erp_sync_error('warehouses', ext,
              format('El depósito %s está deshabilitado en el ERP: queda inactivo.', existing.code), null);
          end if;
        else
          update public.warehouses set synced_at = now() where id = existing.id;
          outcome := 'unchanged';
        end if;
        -- Por si el vínculo no está (p. ej. un depósito importado antes de que existiera el vínculo).
        insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by)
        values (run.company_id, ext, existing.code, run.triggered_by)
        on conflict (company_id, external_warehouse_id) do nothing;
      else
        select warehouse.* into target
        from public.erp_warehouse_mappings mapping
        join public.warehouses warehouse
          on warehouse.company_id = mapping.company_id and warehouse.code = mapping.warehouse_code
        where mapping.company_id = run.company_id and mapping.external_warehouse_id = ext
        for update of warehouse;
        if found and target.external_id is null then
          update public.warehouses
          set external_id = ext, source_system = 'erp', name = v_name, active = v_active, synced_at = now()
          where id = target.id;
          outcome := 'adopted';
          notices := notices || public.erp_sync_error('warehouses', ext,
            format('Ya estaba vinculado a %s: ese depósito pasa a ser "%s" del ERP y conserva sus ubicaciones y pallets.', target.code, v_name), null);
        elsif found then
          outcome := 'merged';
          notices := notices || public.erp_sync_error('warehouses', ext,
            format('Está vinculado a %s, que ya es otro depósito del ERP: sus saldos se suman en %s.', target.code, target.code), null);
        else
          v_code := public.erp_warehouse_code(run.company_id, v_name);
          insert into public.warehouses (company_id, code, name, external_id, source_system, active, synced_at)
          values (run.company_id, v_code, v_name, ext, 'erp', v_active, now());
          insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by)
          values (run.company_id, ext, v_code, run.triggered_by);
          outcome := 'created';
          notices := notices || public.erp_sync_error('warehouses', ext,
            format('Depósito nuevo del ERP: se importó como %s.', v_code), null);
        end if;
      end if;
      counters := public.erp_sync_bump(counters, outcome);
    exception when others then
      get stacked diagnostics err_message = message_text, err_constraint = constraint_name;
      counters := public.erp_sync_bump(counters, 'failed');
      errors := errors || public.erp_sync_error('warehouses', ext, err_message, err_constraint);
    end;
  end loop;

  -- Depósitos del ERP que ya no vienen: inactivos, nunca borrados (tienen ubicaciones, pallets e historial).
  with gone as (
    update public.warehouses
    set active = false, synced_at = now()
    where company_id = run.company_id and source_system = 'erp' and active
      and not (external_id = any(present))
    returning code, external_id
  ), logged as (
    select count(*) as total,
      coalesce(jsonb_agg(public.erp_sync_error('warehouses', external_id,
        format('El depósito %s ya no viene del ERP: queda inactivo.', code), null)), '[]') as items
    from gone
  )
  select total, items into v_deactivated, v_gone_notices from logged;
  counters := jsonb_set(counters, '{deactivated}', to_jsonb(v_deactivated));
  notices := notices || v_gone_notices;

  perform public.erp_sync_save(run.id, 'warehouses', counters, errors);
  perform public.erp_sync_save_notices(run.id, notices);
  return counters;
end;
$$;
revoke all on function public.erp_sync_apply_warehouses(uuid, jsonb) from public, anon;
grant execute on function public.erp_sync_apply_warehouses(uuid, jsonb) to authenticated;

comment on function public.erp_sync_apply_warehouses(uuid, jsonb) is
  'Depósitos del ERP (TRZ-101). Ver el encabezado de 20261029100100_trz101_erp_sync_warehouses.sql.';

/* ---------- Mensaje del saldo de un depósito sin vínculo ---------- */

-- Ya no hay formulario para vincular a mano: un saldo de un depósito sin vínculo es un depósito que el ERP no
-- incluyó en su lista (o que falló al importarse). Solo cambia el texto del error de erp_sync_apply_stock
-- (20261028100000); en lugar de copiar la función entera, se reemplaza el mensaje en su definición actual.
do $$
declare
  definition text := pg_get_functiondef('public.erp_sync_apply_stock(uuid, jsonb)'::regprocedure);
  old_message constant text := 'El depósito "%" del ERP no tiene correspondencia en TrazFlow. Vinculalo desde Pallets.';
  new_message constant text := 'El depósito "%" del ERP no está en su lista de depósitos (o no se pudo importar): revisá los errores de Depósitos.';
begin
  if position(old_message in definition) = 0 then
    raise exception 'erp_sync_apply_stock no tiene el mensaje esperado: revisar esta migración.';
  end if;
  execute replace(definition, old_message, new_message);
end;
$$;
