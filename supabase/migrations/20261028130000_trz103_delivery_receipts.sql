-- TRZ-103: remito firmado por el chofer e informe de entrega al ERP.
--
-- Dos eventos nuevos en el mismo outbox del despacho (TRZ-94), con los mismos reintentos:
--   * delivery_confirmed: cuando la orden queda entregada (o entregada con diferencias), el resultado por pallet
--     y las diferencias. Lo encola un trigger sobre dispatch_orders, así confirm_delivery_pallet no cambia.
--   * delivery_receipt_attached: cada remito firmado que sube el chofer (foto o PDF, hasta 10 MB).
--
-- El archivo va del navegador directo a Supabase Storage (bucket privado delivery-receipts, ruta
-- {empresa}/{orden}/{archivo}); después register_delivery_receipt lo registra y encola el evento. El procesador
-- (src/lib/erp-outbox/processor.ts) elige la operación del contrato por el prefijo de la clave:
--   dispatch:… → reportDispatch · delivery:… → reportDelivery · delivery-receipt:… → attachDeliveryReceipt
-- En ERPNext ambos van al Delivery Note del despacho, que sigue en borrador: lo confirma administración.

/* ---------- Outbox: tipos nuevos ---------- */

alter table public.erp_outbox_events drop constraint erp_outbox_events_event_type_check;
alter table public.erp_outbox_events add constraint erp_outbox_events_event_type_check
  check (event_type in ('dispatch_confirmed', 'delivery_confirmed', 'delivery_receipt_attached'));

-- TRZ-100 consulta el remito de cada evento enviado (erp_outbox_dispatch_documents_due) para el tope de stock.
-- Eso es solo para despachos: los eventos de entrega quedan not_tracked al enviarse y nunca se consultan.
create function public.erp_outbox_untrack_non_dispatch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.event_type <> 'dispatch_confirmed' and new.status = 'sent' and new.erp_document_status is null then
    new.erp_document_status := 'not_tracked';
  end if;
  return new;
end;
$$;
revoke all on function public.erp_outbox_untrack_non_dispatch() from public, anon, authenticated;
create trigger trg_erp_outbox_untrack_non_dispatch before update on public.erp_outbox_events
  for each row execute function public.erp_outbox_untrack_non_dispatch();

/* ---------- Remitos firmados: Storage ---------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-receipts', 'delivery-receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ¿El usuario actual es el chofer asignado a la orden de esa carpeta? La carpeta viene del nombre del objeto:
-- se compara como texto para que un nombre mal formado no rompa con un error de cast.
create function public.delivery_receipt_driver_can_write(p_object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.dispatch_orders orders
    where orders.id::text = (storage.foldername(p_object_name))[2]
      and orders.company_id::text = (storage.foldername(p_object_name))[1]
      and orders.company_id = (select public.auth_company_id())
      and orders.driver_id = (select auth.uid())
      and orders.status in ('confirmed', 'delivered', 'delivered_with_discrepancy')
  );
$$;

-- Quién ve un remito: logística y depósito de la empresa, y el chofer asignado a la orden.
create function public.delivery_receipt_can_read(p_company_id uuid, p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_company_id = (select public.auth_company_id())
    and (
      (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
      or exists (
        select 1 from public.dispatch_orders orders
        where orders.id = p_order_id and orders.company_id = p_company_id and orders.driver_id = (select auth.uid())
      )
    );
$$;

revoke all on function public.delivery_receipt_driver_can_write(text) from public, anon;
revoke all on function public.delivery_receipt_can_read(uuid, uuid) from public, anon;
grant execute on function public.delivery_receipt_driver_can_write(text) to authenticated;
grant execute on function public.delivery_receipt_can_read(uuid, uuid) to authenticated;

-- Solo el chofer sube, y solo a la carpeta de una orden suya. No hay políticas de update ni delete: un remito
-- subido no se reemplaza ni se borra desde la app.
create policy "delivery receipts: driver uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-receipts'
    and (select public.auth_role()) = 'driver_operator'
    and public.delivery_receipt_driver_can_write(name)
  );

create policy "delivery receipts: company reads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'delivery-receipts'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
    and (
      (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
      or public.delivery_receipt_driver_can_write(name)
    )
  );

/* ---------- Remitos firmados: registro ---------- */

create table public.order_delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null references public.dispatch_orders(id) on delete restrict,
  -- Nombre del objeto en el bucket delivery-receipts: {company_id}/{order_id}/{archivo}.
  storage_path text not null unique check (length(storage_path) between 1 and 400),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  -- Tipo y tamaño los toma la base del objeto ya subido, no del navegador.
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_order_delivery_receipts_order on public.order_delivery_receipts(order_id, created_at);

alter table public.order_delivery_receipts enable row level security;
revoke all on public.order_delivery_receipts from anon, authenticated;
grant select on public.order_delivery_receipts to authenticated, service_role;

create policy "delivery receipts: read" on public.order_delivery_receipts
  for select to authenticated
  using (public.delivery_receipt_can_read(company_id, order_id));

-- Máximo de remitos por orden (p. ej. varias hojas fotografiadas).
create function public.delivery_receipts_max_per_order()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;

-- Registra un remito que el chofer ya subió al bucket y, si la orden vino del ERP, encola su envío.
-- Se puede subir mientras la orden está en tránsito o después de cerrarla. Idempotente por storage_path.
--   registered | already_registered | forbidden | invalid_input | order_not_found | invalid_status
--   | file_not_found | invalid_file | limit_reached
create function public.register_delivery_receipt(p_order_id uuid, p_storage_path text, p_file_name text)
returns table (outcome text, receipt_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.dispatch_orders%rowtype;
  v_object storage.objects%rowtype;
  v_receipt public.order_delivery_receipts%rowtype;
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_name text := left(btrim(coalesce(p_file_name, '')), 200);
  v_type text;
  v_size bigint;
  v_count integer;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if p_order_id is null or v_path = '' or length(v_path) > 400 or v_name = '' then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select orders.* into v_order from public.dispatch_orders orders where orders.id = p_order_id for update;
  if not found or v_order.company_id is distinct from public.auth_company_id() then
    return query select 'order_not_found'::text, null::uuid;
    return;
  end if;
  if v_order.driver_id is distinct from auth.uid() then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if v_order.status not in ('confirmed', 'delivered', 'delivered_with_discrepancy') then
    return query select 'invalid_status'::text, null::uuid;
    return;
  end if;
  if v_path not like v_order.company_id::text || '/' || v_order.id::text || '/%'
     or v_path like '%/../%' or (storage.foldername(v_path))[3] is not null then
    return query select 'invalid_input'::text, null::uuid;
    return;
  end if;

  select receipt.* into v_receipt from public.order_delivery_receipts receipt where receipt.storage_path = v_path;
  if found then
    return query select 'already_registered'::text, v_receipt.id;
    return;
  end if;

  select object.* into v_object from storage.objects object
  where object.bucket_id = 'delivery-receipts' and object.name = v_path;
  if not found then
    return query select 'file_not_found'::text, null::uuid;
    return;
  end if;
  v_type := lower(v_object.metadata->>'mimetype');
  v_size := nullif(v_object.metadata->>'size', '')::bigint;
  if v_type is null
     or v_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')
     or v_size is null or v_size < 1 or v_size > 10485760 then
    return query select 'invalid_file'::text, null::uuid;
    return;
  end if;

  select count(*) into v_count from public.order_delivery_receipts receipt where receipt.order_id = v_order.id;
  if v_count >= public.delivery_receipts_max_per_order() then
    return query select 'limit_reached'::text, null::uuid;
    return;
  end if;

  insert into public.order_delivery_receipts (company_id, order_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
  values (v_order.company_id, v_order.id, v_path, v_name, v_type, v_size::integer, auth.uid())
  returning * into v_receipt;

  if v_order.external_id is not null then
    insert into public.erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
    values (
      v_order.company_id,
      'delivery_receipt_attached',
      v_receipt.id,
      'delivery-receipt:' || btrim(v_order.external_id) || ':' || v_receipt.id::text,
      jsonb_build_object(
        'contractVersion', 1,
        'idempotencyKey', 'delivery-receipt:' || btrim(v_order.external_id) || ':' || v_receipt.id::text,
        'orderExternalId', btrim(v_order.external_id),
        'dispatchIdempotencyKey', 'dispatch:' || btrim(v_order.external_id),
        'receiptId', v_receipt.id,
        'storagePath', v_receipt.storage_path,
        'fileName', v_receipt.file_name,
        'contentType', v_receipt.content_type,
        'sizeBytes', v_receipt.size_bytes,
        'uploadedAt', to_char(v_receipt.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'uploadedBy', jsonb_build_object('id', auth.uid(), 'name', (select u.name from public.users u where u.id = auth.uid()))
      ),
      auth.uid()
    )
    on conflict do nothing;
  end if;

  return query select 'registered'::text, v_receipt.id;
end;
$$;

revoke all on function public.register_delivery_receipt(uuid, text, text) from public, anon, service_role;
grant execute on function public.register_delivery_receipt(uuid, text, text) to authenticated;

/* ---------- Entrega confirmada → outbox ---------- */

-- DeliveryReport (contrato v1, src/lib/erp/types.ts) de una orden ya entregada: resultado por pallet esperado y
-- todas las diferencias (también sobrantes y pallets que no correspondían).
create function public.erp_outbox_delivery_payload(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contractVersion', 1,
    'idempotencyKey', 'delivery:' || btrim(orders.external_id),
    'orderExternalId', btrim(orders.external_id),
    'dispatchIdempotencyKey', 'dispatch:' || btrim(orders.external_id),
    'deliveredAt', to_char(coalesce(orders.delivered_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'driver', jsonb_build_object('id', driver.id, 'name', driver.name),
    'needsReview', orders.status = 'delivered_with_discrepancy',
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'palletCode', pallet.qr_code,
          'outcome', coalesce(relation.delivery_outcome, 'missing')
        ) order by pallet.qr_code)
      from public.order_pallets relation
      join public.pallets pallet on pallet.id = relation.pallet_id
      where relation.order_id = orders.id and relation.expected = true
    ), '[]'::jsonb),
    'discrepancies', coalesce((
      select jsonb_agg(jsonb_build_object(
          'palletCode', difference.reported_qr_code,
          'type', difference.discrepancy_type
        ) order by difference.reported_qr_code, difference.discrepancy_type)
      from public.delivery_discrepancies difference
      where difference.order_id = orders.id
    ), '[]'::jsonb))
  from public.dispatch_orders orders
  left join public.users driver on driver.id = coalesce(orders.delivered_by, orders.driver_id)
  where orders.id = p_order_id;
$$;
revoke all on function public.erp_outbox_delivery_payload(uuid) from public, anon, authenticated, service_role;

create function public.enqueue_erp_delivery_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload, created_by)
  values (
    new.company_id,
    'delivery_confirmed',
    new.id,
    'delivery:' || btrim(new.external_id),
    public.erp_outbox_delivery_payload(new.id),
    coalesce(new.delivered_by, new.driver_id)
  )
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.enqueue_erp_delivery_report() from public, anon, authenticated;

-- Solo las órdenes que vinieron del ERP: las cargadas a mano no tienen a quién informarse.
create trigger trg_dispatch_orders_erp_delivery after update of status on public.dispatch_orders
  for each row
  when (
    new.status in ('delivered', 'delivered_with_discrepancy')
    and old.status is distinct from new.status
    and new.external_id is not null
  )
  execute function public.enqueue_erp_delivery_report();
