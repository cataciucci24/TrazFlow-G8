-- TRZ-100 (2/4): estado del remito en el ERP de cada despacho reportado.
--
-- reportDispatch deja en ERPNext un Delivery Note en borrador: el stock del ERP recién baja cuando alguien de
-- administración lo confirma (docs/erp-contract.md §8). Para saber cuándo los pallets despachados dejan de
-- contar contra el saldo (20261028100300), TrazFlow pregunta por el remito con la operación
-- getDispatchStatus(idempotencyKey) del contrato y guarda la respuesta en el mismo evento del outbox, porque es
-- la continuación de ese reporte:
--
--   erp_outbox_dispatch_documents_due → ErpClient.getDispatchStatus → erp_outbox_record_dispatch_document
--
-- Lo hace checkErpDispatchDocuments (src/lib/erp-outbox/dispatch-documents.ts), al principio de cada
-- sincronización y, más adelante, desde el cron de TRZ-104 con service_role.

alter table public.erp_outbox_events
  -- null = todavía sin consultar. not_tracked = evento anterior a TRZ-100 (ver abajo): no se consulta nunca.
  add column erp_document_status text
    check (erp_document_status in ('draft', 'confirmed', 'cancelled', 'not_found', 'not_tracked')),
  add column erp_document_checked_at timestamptz,
  -- Primera vez que TrazFlow vio el remito confirmado. No vuelve a cambiar (ni si después se anula). El tope
  -- compara contra este momento, no contra la hora del ERP: así no depende de la zona horaria de ERPNext.
  add column erp_document_confirmed_seen_at timestamptz,
  add constraint erp_outbox_events_document_sent_check
    check (erp_document_status is null or status = 'sent'),
  add constraint erp_outbox_events_document_seen_check
    check (erp_document_confirmed_seen_at is null or erp_document_status in ('confirmed', 'cancelled', 'not_found'));

-- Los reportes ya enviados son de antes de TRZ-100: en la nube, remitos del ERP mock (MOCK-DN-000x) que
-- ERPNext no conoce. No se consultan y sus pallets no cuentan para el tope.
update public.erp_outbox_events
set erp_document_status = 'not_tracked'
where status = 'sent';

create index idx_erp_outbox_documents_due on public.erp_outbox_events(company_id, erp_document_checked_at)
  where status = 'sent' and (erp_document_status is null or erp_document_status in ('draft', 'not_found', 'cancelled'));

/* ---------- RPC ---------- */

-- Reportes enviados cuyo remito hay que (re)consultar: sin consultar, en borrador, no encontrado o anulado.
-- Primero los nunca consultados, después los que hace más que no se miran.
--   * Se reconsultan los anulados y no encontrados: en ERPNext un remito anulado se puede corregir (amend) y
--     un borrador borrado se puede volver a crear; mientras tanto sus pallets siguen contando (no salieron del
--     stock del ERP) y la vista avisa.
--   * Los confirmados no se reconsultan. Si alguien anula un remito ya confirmado, TrazFlow no se entera
--     (limitación documentada en docs/erp-sync.md).
-- service_role (cron de TRZ-104) indica la empresa; un usuario de logística o depósito solo puede pedir la suya.
create function public.erp_outbox_dispatch_documents_due(p_company_id uuid, p_limit integer default 20)
returns table (id uuid, idempotency_key text, erp_reference text, erp_document_status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.erp_outbox_actor_company();
begin
  if p_company_id is null then
    raise exception 'Falta la empresa.' using errcode = '22023';
  end if;
  if v_company is not null and v_company is distinct from p_company_id then
    raise exception 'No tenés permisos sobre los reportes de otra empresa.' using errcode = '42501';
  end if;

  return query
  select event.id, event.idempotency_key, event.erp_reference, event.erp_document_status
  from public.erp_outbox_events event
  where event.company_id = p_company_id
    and event.status = 'sent'
    and (event.erp_document_status is null or event.erp_document_status in ('draft', 'not_found', 'cancelled'))
  order by event.erp_document_checked_at nulls first, event.sent_at, event.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

-- Guarda lo que respondió el ERP. erp_document_confirmed_seen_at solo se fija la primera vez que se ve
-- `confirmed`. Si el ERP informa la referencia del remito (p. ej. uno corregido), reemplaza a la guardada.
-- Devuelve false si el evento no existe, no es de la empresa, no está enviado o es not_tracked.
create function public.erp_outbox_record_dispatch_document(p_event_id uuid, p_status text, p_erp_reference text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.erp_outbox_actor_company();
begin
  if p_status is null or p_status not in ('draft', 'confirmed', 'cancelled', 'not_found') then
    raise exception 'Estado de remito inválido: %.', coalesce(p_status, '(vacío)') using errcode = '22023';
  end if;

  update public.erp_outbox_events event
  set erp_document_status = p_status,
      erp_document_checked_at = now(),
      erp_document_confirmed_seen_at = coalesce(
        event.erp_document_confirmed_seen_at,
        case when p_status = 'confirmed' then now() end),
      erp_reference = coalesce(left(nullif(btrim(p_erp_reference), ''), 300), event.erp_reference)
  where event.id = p_event_id
    and event.status = 'sent'
    and event.erp_document_status is distinct from 'not_tracked'
    and (v_company is null or event.company_id = v_company);
  return found;
end;
$$;

revoke all on function public.erp_outbox_dispatch_documents_due(uuid, integer) from public, anon;
revoke all on function public.erp_outbox_record_dispatch_document(uuid, text, text) from public, anon;
grant execute on function public.erp_outbox_dispatch_documents_due(uuid, integer) to authenticated, service_role;
grant execute on function public.erp_outbox_record_dispatch_document(uuid, text, text) to authenticated, service_role;

/* ---------- Auditoría en la sincronización ---------- */

-- La consulta de remitos corre dentro de syncCompanyFromErp, antes de pullMasterData. Su resultado queda en la
-- misma ejecución: counters.dispatch_documents y errores con entity 'dispatch_document'. Los errores se
-- rearman acá (entidad fija, mensajes recortados): el servidor no puede escribir cualquier cosa en la auditoría.
create function public.erp_sync_save_dispatch_documents(p_run_id uuid, p_counters jsonb, p_errors jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  run public.erp_sync_runs := public.erp_sync_lock_run(p_run_id);
  allowed constant text[] := array['received', 'draft', 'confirmed', 'cancelled', 'not_found', 'failed'];
  counters jsonb := '{}';
  errors jsonb := '[]';
  item record;
begin
  if jsonb_typeof(p_counters) is distinct from 'object' or jsonb_typeof(p_errors) is distinct from 'array' then
    raise exception 'Formato inválido del resultado de la consulta de remitos.' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(p_counters) loop
    if item.key = any(allowed) and jsonb_typeof(item.value) = 'number' then
      counters := counters || jsonb_build_object(item.key, greatest(0, (item.value #>> '{}')::numeric)::integer);
    end if;
  end loop;
  select coalesce(jsonb_agg(public.erp_sync_error(
      'dispatch_document',
      left(nullif(btrim(err.value->>'external_id'), ''), 300),
      coalesce(nullif(btrim(err.value->>'message'), ''), 'Error desconocido al consultar el remito.'),
      null) order by err.position), '[]')
    into errors
  from jsonb_array_elements(p_errors) with ordinality as err(value, position)
  where err.position <= 50 and jsonb_typeof(err.value) = 'object';

  perform public.erp_sync_save(run.id, 'dispatch_documents', counters, errors);
end;
$$;

revoke all on function public.erp_sync_save_dispatch_documents(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.erp_sync_save_dispatch_documents(uuid, jsonb, jsonb) to authenticated;
