-- TRZ-100 (segunda parte): volver a escanear un pallet cuya validación se borró al cambiarle la cantidad.
--
-- update_assigned_pallet_quantity (20261028100500) borra la validación de un pallet ya escaneado para que depósito
-- lo vuelva a escanear. Pero idx_events_single_qr_validation admitía un solo evento qr_scan por (orden, pallet), así
-- que el segundo escaneo fallaba con unique_violation. El historial no se borra (es inmutable).
--
-- Ahora cada escaneo lleva su ronda en details.validation_round (1 el primero, 2 después de una edición, ...). El
-- índice pasa a ser "un qr_scan por (orden, pallet, ronda)": sigue impidiendo dos validaciones del mismo escaneo,
-- y los eventos anteriores (sin ronda) cuentan como ronda 1. La ronda se calcula contando los qr_scan previos,
-- con la fila de order_pallets bloqueada (`for update`), así que dos escaneos simultáneos no toman la misma.

drop index public.idx_events_single_qr_validation;
create unique index idx_events_single_qr_validation
  on public.traceability_events (order_id, pallet_id, (coalesce(details->>'validation_round', '1')))
  where event_type = 'qr_scan';

-- Igual que en 20260919180000_add_order_notifications.sql, más validation_round en el evento qr_scan.
create or replace function validate_order_pallet(
  p_order_id uuid,
  p_qr_code text
)
returns table (
  outcome text,
  pallet_id uuid,
  qr_code text,
  product_name text,
  product_sku text,
  batch_number text,
  validated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pallet pallets%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_product_name text;
  v_product_sku text;
  v_batch_number text;
  v_validated_at timestamptz := now();
  v_round integer;
begin
  if auth.uid() is null or auth_role() is distinct from 'warehouse_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
    from dispatch_orders orders
    where orders.id = p_order_id
      and orders.company_id = auth_company_id()
  ) then
    return query select 'order_not_found', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.*
    into v_pallet
  from pallets pallet
  where pallet.qr_code = btrim(p_qr_code)
    and pallet.company_id = auth_company_id();

  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select relation.*
    into v_order_pallet
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.pallet_id = v_pallet.id
  for update;

  if not found then
    insert into traceability_events (
      company_id,
      pallet_id,
      order_id,
      event_type,
      user_id,
      details,
      created_at
    ) values (
      auth_company_id(),
      v_pallet.id,
      p_order_id,
      'dispatch_discrepancy',
      auth.uid(),
      jsonb_build_object(
        'type', 'wrong_order',
        'qr_code', v_pallet.qr_code
      ),
      v_validated_at
    );

    insert into order_notifications (
      company_id,
      order_id,
      pallet_id,
      event_type,
      description,
      created_by,
      created_at
    ) values (
      auth_company_id(),
      p_order_id,
      v_pallet.id,
      'dispatch_wrong_pallet',
      format('Se escaneó el pallet %s, que no pertenece a esta orden de despacho.', v_pallet.qr_code),
      auth.uid(),
      v_validated_at
    );

    return query select 'wrong_order', v_pallet.id, v_pallet.qr_code,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select product.name, product.sku, batch.batch_number
    into v_product_name, v_product_sku, v_batch_number
  from batches batch
  join products product on product.id = batch.product_id
  where batch.id = v_pallet.batch_id;

  if v_order_pallet.validated_at is not null then
    return query select 'already_validated', v_pallet.id, v_pallet.qr_code,
      v_product_name, v_product_sku, v_batch_number,
      v_order_pallet.validated_at;
    return;
  end if;

  update order_pallets relation
  set detected_at_dispatch = true,
      validated_at = v_validated_at,
      validated_by = auth.uid()
  where relation.order_id = p_order_id
    and relation.pallet_id = v_pallet.id;

  -- TRZ-100: ronda de este escaneo (la fila de order_pallets está bloqueada desde arriba).
  select count(*) + 1
    into v_round
  from traceability_events event
  where event.order_id = p_order_id
    and event.pallet_id = v_pallet.id
    and event.event_type = 'qr_scan';

  insert into traceability_events (
    company_id,
    pallet_id,
    order_id,
    event_type,
    user_id,
    details,
    created_at
  ) values (
    auth_company_id(),
    v_pallet.id,
    p_order_id,
    'qr_scan',
    auth.uid(),
    jsonb_build_object('qr_code', v_pallet.qr_code, 'validation_round', v_round),
    v_validated_at
  );

  return query select 'validated', v_pallet.id, v_pallet.qr_code,
    v_product_name, v_product_sku, v_batch_number, v_validated_at;
end;
$$;

revoke all on function validate_order_pallet(uuid, text) from public;
grant execute on function validate_order_pallet(uuid, text) to authenticated;
