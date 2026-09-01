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
security invoker
set search_path = public
as $$
declare
  v_pallet pallets%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_product_name text;
  v_product_sku text;
  v_batch_number text;
  v_validated_at timestamptz := now();
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
    jsonb_build_object('qr_code', v_pallet.qr_code),
    v_validated_at
  );

  return query select 'validated', v_pallet.id, v_pallet.qr_code,
    v_product_name, v_product_sku, v_batch_number, v_validated_at;
end;
$$;

revoke all on function validate_order_pallet(uuid, text) from public;

grant execute on function validate_order_pallet(uuid, text) to authenticated;