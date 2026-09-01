-- ============================================================================
-- US3: validación de pallets mediante QR
-- ============================================================================

alter table order_pallets
  add column validated_at timestamptz,
  add column validated_by uuid references users(id),
  add constraint order_pallets_validation_complete check (
    (validated_at is null and validated_by is null)
    or (validated_at is not null and validated_by is not null)
  );

create unique index idx_events_single_qr_validation
  on traceability_events(order_id, pallet_id, event_type)
  where event_type = 'qr_scan';

-- El GRANT general del schema no debe permitir modificar campos de otras US.
revoke update on order_pallets from authenticated;
grant update (detected_at_dispatch, validated_at, validated_by)
  on order_pallets to authenticated;

-- Estos helpers evitan que las policies de order_pallets consulten pallets,
-- cuya policy a su vez consulta order_pallets y produciría recursión RLS.
create or replace function order_belongs_to_auth_company(order_uuid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from dispatch_orders
    where id = order_uuid and company_id = auth_company_id()
  );
$$;

create or replace function pallet_belongs_to_auth_company(pallet_uuid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from pallets
    where id = pallet_uuid and company_id = auth_company_id()
  );
$$;

revoke all on function order_belongs_to_auth_company(uuid) from public;
revoke all on function pallet_belongs_to_auth_company(uuid) from public;
grant execute on function order_belongs_to_auth_company(uuid) to authenticated;
grant execute on function pallet_belongs_to_auth_company(uuid) to authenticated;

-- La policy original permitía cualquier escritura a todos los usuarios que
-- pudieran ver la orden. Se separan las operaciones para que US2 conserve la
-- asociación y solo depósito pueda actualizar la validación de US3.
drop policy order_pallets_write on order_pallets;

create policy order_pallets_insert_manager on order_pallets
  for insert with check (
    auth_role() = 'logistics_manager'
    and order_belongs_to_auth_company(order_id)
    and pallet_belongs_to_auth_company(pallet_id)
  );

create policy order_pallets_update_warehouse on order_pallets
  for update using (
    auth_role() = 'warehouse_operator'
    and order_belongs_to_auth_company(order_id)
    and pallet_belongs_to_auth_company(pallet_id)
  )
  with check (
    auth_role() = 'warehouse_operator'
    and order_belongs_to_auth_company(order_id)
    and pallet_belongs_to_auth_company(pallet_id)
    and detected_at_dispatch = true
    and validated_at is not null
    and validated_by = auth.uid()
  );

-- La auditoría sigue disponible para US2 y se habilita para US3. La compañía
-- del evento debe ser siempre la del usuario autenticado.
drop policy events_insert on traceability_events;

create policy events_insert_authorized_roles on traceability_events
  for insert with check (
    company_id = auth_company_id()
    and auth_role() in ('logistics_manager', 'warehouse_operator')
  );

-- La función corre con los permisos y RLS del usuario que la invoca. Cada
-- llamada es una transacción: la validación y el evento se confirman juntos o
-- se revierten juntos ante cualquier error.
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
