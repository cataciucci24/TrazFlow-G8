-- TRZ-103 (2/2): la entrega y el remito firmado se mandan al ERP apenas el chofer los registra.
--
-- erp_outbox_claim / mark_sent / mark_failed solo los puede usar logística, depósito o service_role
-- (erp_outbox_actor_company). En lugar de abrírselos al chofer, que le daría acceso a los despachos y a las
-- órdenes de otros choferes, estas tres funciones hacen lo mismo pero limitado a los eventos de entrega
-- (delivery_confirmed, delivery_receipt_attached) de UNA orden asignada al chofer que llama. El backoff, los
-- intentos y el lease son los mismos: un envío que falla queda para los procesadores de siempre.
--
-- Las usa processDriverDeliveryEvents (src/lib/erp-outbox/run.ts) en un after() de las acciones del chofer.

-- Orden a la que pertenece un evento de entrega: la propia orden, o la del remito registrado.
create function public.erp_outbox_delivery_event_order(p_event public.erp_outbox_events)
returns uuid language sql stable security definer set search_path = '' as $$
  select case p_event.event_type
    when 'delivery_confirmed' then p_event.aggregate_id
    when 'delivery_receipt_attached' then (
      select receipt.order_id from public.order_delivery_receipts receipt where receipt.id = p_event.aggregate_id)
  end;
$$;
revoke all on function public.erp_outbox_delivery_event_order(public.erp_outbox_events) from public, anon, authenticated, service_role;

-- El chofer de la sesión, si es driver_operator. Si no, 42501.
create function public.erp_outbox_driver_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then
    raise exception 'Solo el chofer asignado puede enviar su entrega al ERP.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.erp_outbox_driver_actor() from public, anon, authenticated, service_role;

-- ¿El evento es de entrega y su orden está asignada a este chofer (en su empresa)?
create function public.erp_outbox_driver_owns(p_event public.erp_outbox_events, p_driver uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_event.event_type in ('delivery_confirmed', 'delivery_receipt_attached')
    and exists (
      select 1 from public.dispatch_orders orders
      where orders.id = public.erp_outbox_delivery_event_order(p_event)
        and orders.company_id = p_event.company_id
        and orders.driver_id = p_driver
        and orders.company_id = public.auth_company_id()
    );
$$;
revoke all on function public.erp_outbox_driver_owns(public.erp_outbox_events, uuid) from public, anon, authenticated, service_role;

-- Como erp_outbox_claim, pero solo los eventos de entrega vencidos de una orden del chofer.
create function public.erp_outbox_driver_claim(p_order_id uuid)
returns table (id uuid, idempotency_key text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := public.erp_outbox_driver_actor();
begin
  if p_order_id is null then
    raise exception 'Falta la orden.' using errcode = '22023';
  end if;

  return query
  with due as (
    select event.id
    from public.erp_outbox_events event
    where event.event_type in ('delivery_confirmed', 'delivery_receipt_attached')
      and public.erp_outbox_delivery_event_order(event) = p_order_id
      and public.erp_outbox_driver_owns(event, v_driver)
      and event.attempts < public.erp_outbox_max_attempts()
      and ((event.status = 'pending' and event.next_attempt_at <= now())
        or (event.status = 'processing' and event.locked_until < now()))
    order by event.next_attempt_at, event.created_at
    limit 10
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

-- Igual que erp_outbox_mark_sent, limitado a los eventos de entrega del chofer.
create function public.erp_outbox_driver_mark_sent(p_event_id uuid, p_attempt integer, p_erp_reference text, p_duplicate boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := public.erp_outbox_driver_actor();
begin
  update public.erp_outbox_events event
  set status = 'sent', sent_at = now(), locked_until = null,
      erp_reference = left(nullif(btrim(p_erp_reference), ''), 300),
      erp_duplicate = coalesce(p_duplicate, false),
      last_error_code = null, last_error = null
  where event.id = p_event_id and event.status = 'processing' and event.attempts = p_attempt
    and public.erp_outbox_driver_owns(event, v_driver);
  return found;
end;
$$;

-- Igual que erp_outbox_mark_failed, limitado a los eventos de entrega del chofer.
create function public.erp_outbox_driver_mark_failed(
  p_event_id uuid,
  p_attempt integer,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := public.erp_outbox_driver_actor();
  v_status text;
begin
  update public.erp_outbox_events event
  set status = case
        when p_retryable and event.attempts < public.erp_outbox_max_attempts() then 'pending'
        else 'failed'
      end,
      next_attempt_at = case
        when p_retryable and event.attempts < public.erp_outbox_max_attempts()
          then now() + public.erp_outbox_backoff(event.attempts)
        else event.next_attempt_at
      end,
      locked_until = null,
      last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'unknown'), 40),
      last_error = left(coalesce(nullif(btrim(p_error_message), ''), 'Error desconocido al reportar al ERP.'), 500)
  where event.id = p_event_id and event.status = 'processing' and event.attempts = p_attempt
    and public.erp_outbox_driver_owns(event, v_driver)
  returning event.status into v_status;
  return v_status;
end;
$$;

revoke all on function public.erp_outbox_driver_claim(uuid) from public, anon, service_role;
revoke all on function public.erp_outbox_driver_mark_sent(uuid, integer, text, boolean) from public, anon, service_role;
revoke all on function public.erp_outbox_driver_mark_failed(uuid, integer, text, text, boolean) from public, anon, service_role;
grant execute on function public.erp_outbox_driver_claim(uuid) to authenticated;
grant execute on function public.erp_outbox_driver_mark_sent(uuid, integer, text, boolean) to authenticated;
grant execute on function public.erp_outbox_driver_mark_failed(uuid, integer, text, text, boolean) to authenticated;
