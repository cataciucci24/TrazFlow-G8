-- ============================================================================
-- US6: registrar la recepción de un pallet
-- ============================================================================

-- Una recepción confirmada solo puede generar un evento y un movimiento para
-- el mismo pallet dentro de la misma orden, incluso ante reintentos.
create unique index idx_events_single_reception
  on traceability_events(order_id, pallet_id, event_type)
  where event_type = 'reception';

create unique index idx_movements_single_reception
  on movements(order_id, pallet_id)
  where resulting_status = 'received';

-- La policy anterior permitía actualizar pallets tanto a cualquier usuario de
-- la empresa propietaria como a operadores del distribuidor destinatario. US2
-- depende del UPDATE del logistics_manager y US5 del warehouse_operator; ambos
-- accesos se conservan para pallets de su compañía. El distributor_operator ya
-- no puede mutarlos directamente: la recepción solo pasa por el RPC protegido.
drop policy pallets_update on pallets;

create policy pallets_update_internal_roles on pallets
  for update using (
    auth_role() in ('logistics_manager', 'warehouse_operator')
    and company_id = auth_company_id()
  )
  with check (
    auth_role() in ('logistics_manager', 'warehouse_operator')
    and company_id = auth_company_id()
  );

-- El operador necesita resolver el nombre del distribuidor para las órdenes
-- que le fueron asignadas. La policy original de la empresa se mantiene.
create policy distributors_select_operator on distributors
  for select using (
    auth_role() = 'distributor_operator'
    and operates_for_distributor(id)
  );

-- Los eventos siguen siendo append-only. US6 agrega solo lectura de eventos de
-- órdenes destinadas al distribuidor del operador; no habilita INSERT directo.
create policy events_select_distributor on traceability_events
  for select using (
    auth_role() = 'distributor_operator'
    and order_id in (
      select orders.id
      from dispatch_orders orders
      where operates_for_distributor(orders.distributor_id)
    )
  );

-- Devuelve únicamente pallets asociados a una orden del distribuidor del
-- usuario. SECURITY DEFINER permite resolver producto/lote sin abrir policies
-- generales sobre products o batches.
create or replace function get_order_pallet_receptions(p_order_id uuid)
returns table (
  pallet_id uuid,
  qr_code text,
  product_name text,
  product_sku text,
  batch_number text,
  received boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_distributor_id uuid;
begin
  if auth.uid() is null
     or auth_role() is distinct from 'distributor_operator'
     or p_order_id is null then
    return;
  end if;

  select orders.distributor_id
    into v_distributor_id
  from dispatch_orders orders
  where orders.id = p_order_id;

  if not found or not operates_for_distributor(v_distributor_id) then
    return;
  end if;

  return query
  select pallet.id,
         pallet.qr_code,
         product.name,
         product.sku,
         batch.batch_number,
         relation.received
  from order_pallets relation
  join pallets pallet on pallet.id = relation.pallet_id
  join batches batch on batch.id = pallet.batch_id
  join products product on product.id = batch.product_id
  where relation.order_id = p_order_id
    and relation.expected = true
  order by pallet.qr_code;
end;
$$;

revoke all on function get_order_pallet_receptions(uuid) from public;
grant execute on function get_order_pallet_receptions(uuid) to authenticated;

-- La función valida nuevamente identidad, rol, distribuidor, orden y pallet.
-- Al ser una única invocación PostgreSQL, todas sus escrituras se confirman o
-- revierten juntas. Los bloqueos serializan recepciones concurrentes.
create or replace function receive_order_pallet(
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
  registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order dispatch_orders%rowtype;
  v_pallet pallets%rowtype;
  v_order_pallet order_pallets%rowtype;
  v_destination text;
  v_product_name text;
  v_product_sku text;
  v_batch_number text;
  v_registered_at timestamptz := now();
begin
  if auth.uid() is null or auth_role() is distinct from 'distributor_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_order_id is null
     or p_qr_code is null
     or btrim(p_qr_code) = ''
     or length(btrim(p_qr_code)) > 512 then
    return query select 'invalid_input', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select orders.*
    into v_order
  from dispatch_orders orders
  where orders.id = p_order_id
  for update;

  if not found then
    return query select 'order_not_found', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if not operates_for_distributor(v_order.distributor_id) then
    return query select 'forbidden', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_order.status <> 'confirmed' then
    return query select 'invalid_status', null::uuid, null::text, null::text,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.*
    into v_pallet
  from pallets pallet
  where pallet.qr_code = btrim(p_qr_code)
  for update;

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
    and relation.expected = true
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

  if v_order_pallet.received then
    return query select 'already_received', v_pallet.id, v_pallet.qr_code,
      v_product_name, v_product_sku, v_batch_number, null::timestamptz;
    return;
  end if;

  if v_pallet.status <> 'in_transit' then
    return query select 'invalid_pallet_status', v_pallet.id, v_pallet.qr_code,
      v_product_name, v_product_sku, v_batch_number, null::timestamptz;
    return;
  end if;

  select distributor.name
    into v_destination
  from distributors distributor
  where distributor.id = v_order.distributor_id;

  update order_pallets relation
  set received = true
  where relation.order_id = p_order_id
    and relation.pallet_id = v_pallet.id;

  update pallets pallet
  set status = 'received',
      current_location = v_destination
  where pallet.id = v_pallet.id;

  insert into movements (
    pallet_id,
    order_id,
    origin_location,
    destination_location,
    resulting_status,
    user_id,
    created_at
  ) values (
    v_pallet.id,
    p_order_id,
    v_pallet.current_location,
    v_destination,
    'received',
    auth.uid(),
    v_registered_at
  );

  insert into traceability_events (
    company_id,
    pallet_id,
    order_id,
    event_type,
    user_id,
    details,
    created_at
  ) values (
    v_order.company_id,
    v_pallet.id,
    p_order_id,
    'reception',
    auth.uid(),
    jsonb_build_object(
      'qr_code', v_pallet.qr_code,
      'distributor_id', v_order.distributor_id,
      'destination_location', v_destination
    ),
    v_registered_at
  );

  return query select 'received', v_pallet.id, v_pallet.qr_code,
    v_product_name, v_product_sku, v_batch_number, v_registered_at;
end;
$$;

revoke all on function receive_order_pallet(uuid, text) from public;
grant execute on function receive_order_pallet(uuid, text) to authenticated;
