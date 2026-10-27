-- TRZ-100 (segunda parte): no se confirma el despacho de una orden del ERP si lo armado no coincide con lo pedido.
--
-- El contrato con el ERP admite un solo reporte de despacho por orden (clave dispatch:{orden}). Si se confirmara
-- con faltantes, lo que quedó sin despachar no se podría despachar nunca más desde TrazFlow; si se confirmara con
-- sobrantes, se le informaría al ERP más de lo que pidió.
--
-- Regla: si la orden vino del ERP (external_id no nulo) y tiene líneas (dispatch_order_lines), para cada producto
-- la suma de las cantidades de los pallets asociados con expected = true tiene que ser igual a la suma de las
-- líneas de ese producto. Un producto armado que la orden no pide también es diferencia. La comparación es exacta
-- en todas las unidades (también en kilogramos), redondeada a 2 decimales como las cantidades de la app; un pallet
-- sin cantidad cuenta 0. Si no coincide devuelve outcome = 'quantity_mismatch' (sin excepción, como
-- missing_pallets). El detalle por producto lo arma la app (src/lib/orders/lines.ts).
--
-- Sin cambios: órdenes manuales (external_id nulo) y órdenes del ERP importadas antes de TRZ-100 (sin líneas).

-- Igual que en 20261019140000_erp_dispatch_outbox.sql, más el chequeo de cantidades después de missing_pallets.
create or replace function confirm_dispatch_order(
  p_order_id uuid
)
returns table (
  outcome text,
  order_id uuid,
  status text,
  confirmed_at timestamptz,
  pallet_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order dispatch_orders%rowtype;
  v_total integer;
  v_missing integer;
  v_missing_ids uuid[];
  v_last_missing_ids uuid[];
  v_mismatched integer;
  v_confirmed_at timestamptz := now();
begin
  if auth.uid() is null or auth_role() is distinct from 'warehouse_operator' then
    return query select 'forbidden', null::uuid, null::text,
      null::timestamptz, null::integer;
    return;
  end if;

  select orders.*
    into v_order
  from dispatch_orders orders
  where orders.id = p_order_id
    and orders.company_id = auth_company_id()
  for update;

  if not found then
    return query select 'order_not_found', null::uuid, null::text,
      null::timestamptz, null::integer;
    return;
  end if;

  if v_order.status <> 'draft' then
    return query select 'invalid_status', v_order.id, v_order.status::text,
      v_order.confirmed_at, null::integer;
    return;
  end if;

  select count(*)
    into v_total
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.expected = true;

  if v_total = 0 then
    return query select 'no_pallets', v_order.id, v_order.status::text,
      null::timestamptz, null::integer;
    return;
  end if;

  select array_agg(relation.pallet_id order by relation.pallet_id)
    into v_missing_ids
  from order_pallets relation
  where relation.order_id = p_order_id
    and relation.expected = true
    and relation.validated_at is null;

  v_missing := coalesce(array_length(v_missing_ids, 1), 0);

  if v_missing > 0 then
    select notification.missing_pallet_ids
      into v_last_missing_ids
    from order_notifications notification
    where notification.order_id = p_order_id
      and notification.event_type = 'dispatch_missing_pallets'
    order by notification.seq desc
    limit 1;

    if v_last_missing_ids is null or v_last_missing_ids <> v_missing_ids then
      insert into order_notifications (
        company_id,
        order_id,
        missing_pallet_ids,
        event_type,
        description,
        created_by
      ) values (
        auth_company_id(),
        p_order_id,
        v_missing_ids,
        'dispatch_missing_pallets',
        format('Quedan %s pallet(s) esperados sin validar; no se pudo confirmar el despacho.', v_missing),
        auth.uid()
      );
    end if;

    return query select 'missing_pallets', v_order.id, v_order.status::text,
      null::timestamptz, v_missing;
    return;
  end if;

  -- TRZ-100: pedido vs. armado, solo para órdenes del ERP con líneas.
  if v_order.external_id is not null
     and exists (select 1 from dispatch_order_lines line where line.order_id = p_order_id) then
    select count(*)
      into v_mismatched
    from (
      select line.product_id, sum(line.quantity) as requested
      from dispatch_order_lines line
      where line.order_id = p_order_id
      group by line.product_id
    ) requested
    full join (
      select batch.product_id, sum(coalesce(pallet.quantity, 0)) as built
      from order_pallets relation
      join pallets pallet on pallet.id = relation.pallet_id
      join batches batch on batch.id = pallet.batch_id
      where relation.order_id = p_order_id
        and relation.expected = true
      group by batch.product_id
    ) built on built.product_id = requested.product_id
    where round(coalesce(requested.requested, 0), 2) <> round(coalesce(built.built, 0), 2);

    if v_mismatched > 0 then
      return query select 'quantity_mismatch', v_order.id, v_order.status::text,
        null::timestamptz, null::integer;
      return;
    end if;
  end if;

  update dispatch_orders
  set status = 'confirmed',
      confirmed_at = v_confirmed_at
  where id = p_order_id;

  update pallets
  set status = 'in_transit',
      current_location = 'En tránsito'
  where id in (
    select relation.pallet_id
    from order_pallets relation
    where relation.order_id = p_order_id
      and relation.expected = true
  );

  insert into traceability_events (
    company_id,
    order_id,
    event_type,
    user_id,
    details,
    created_at
  ) values (
    auth_company_id(),
    p_order_id,
    'dispatch_confirmed',
    auth.uid(),
    jsonb_build_object('pallet_count', v_total),
    v_confirmed_at
  );

  -- US-ERP-04: las órdenes que vinieron del ERP se le informan. Las cargadas a mano no tienen a quién.
  if v_order.external_id is not null then
    insert into erp_outbox_events (
      company_id,
      event_type,
      aggregate_id,
      idempotency_key,
      payload,
      created_by
    ) values (
      v_order.company_id,
      'dispatch_confirmed',
      p_order_id,
      'dispatch:' || btrim(v_order.external_id),
      erp_outbox_dispatch_payload(p_order_id, auth.uid(), v_confirmed_at),
      auth.uid()
    )
    on conflict do nothing;
  end if;

  return query select 'confirmed', v_order.id, 'confirmed'::text,
    v_confirmed_at, v_total;
end;
$$;

revoke all on function confirm_dispatch_order(uuid) from public;
grant execute on function confirm_dispatch_order(uuid) to authenticated;
