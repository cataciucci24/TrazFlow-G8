-- ============================================================================
-- US-ERP-01: rol chofer, destinatario sin cuenta y estados de entrega
-- US-OPS-07: confirmación de entrega por chofer asignado
-- ============================================================================

alter table public.dispatch_orders
  add column if not exists driver_id uuid references public.users(id) on delete restrict,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid references public.users(id) on delete restrict;

create index if not exists idx_dispatch_orders_driver_status
  on public.dispatch_orders(driver_id, status);

alter table public.order_pallets
  add column if not exists delivery_outcome text
    check (delivery_outcome in ('delivered', 'missing', 'damaged')),
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid references public.users(id) on delete restrict;

-- Las recepciones históricas representan entregas en el modelo nuevo.
update public.dispatch_orders set
  status = case
    when status = 'received' then 'delivered'::public.order_status
    else 'delivered_with_discrepancy'::public.order_status
  end,
  delivered_at = coalesce(delivered_at, received_at)
where status in ('received', 'received_with_discrepancy');

update public.pallets set status = 'delivered'::public.pallet_status
where status = 'received';

create table if not exists public.delivery_discrepancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null references public.dispatch_orders(id) on delete restrict,
  pallet_id uuid references public.pallets(id) on delete restrict,
  reported_qr_code text not null,
  discrepancy_type text not null
    check (discrepancy_type in ('missing', 'surplus', 'damaged', 'wrong_order')),
  driver_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (order_id, pallet_id, discrepancy_type)
);

create index if not exists idx_delivery_discrepancies_order
  on public.delivery_discrepancies(order_id, created_at desc);

alter table public.delivery_discrepancies enable row level security;
revoke insert, update, delete on public.delivery_discrepancies from authenticated, anon;
grant select on public.delivery_discrepancies to authenticated;

-- Los roles solicitables pasan a ser depósito o chofer. El rol anterior queda
-- en el enum únicamente para permitir una transición explícita de datos.
alter table public.access_requests
  drop constraint if exists access_requests_requested_role_check;
alter table public.access_requests
  add constraint access_requests_requested_role_check
  check (requested_role in ('warehouse_operator', 'driver_operator', 'distributor_operator'));

-- Las solicitudes pendientes todavía no representan operación histórica y se
-- pueden adaptar al rol nuevo. Las aprobadas/rechazadas conservan auditoría.
update public.access_requests set requested_role = 'driver_operator'
where requested_role = 'distributor_operator' and status = 'pending';

-- El chofer ve solamente órdenes que le fueron asignadas. Los roles internos
-- conservan el acceso por empresa.
drop policy if exists orders_select on public.dispatch_orders;
create policy orders_select on public.dispatch_orders
  for select to authenticated using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (auth_role() = 'driver_operator' and driver_id = auth.uid())
  );

drop policy if exists order_pallets_select on public.order_pallets;
create policy order_pallets_select on public.order_pallets
  for select to authenticated using (
    exists (
      select 1 from public.dispatch_orders orders
      where orders.id = order_id
        and (
          (auth_role() in ('logistics_manager', 'warehouse_operator') and orders.company_id = auth_company_id())
          or (auth_role() = 'driver_operator' and orders.driver_id = auth.uid())
        )
    )
  );

drop policy if exists pallets_select on public.pallets;
create policy pallets_select on public.pallets
  for select to authenticated using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (
      auth_role() = 'driver_operator'
      and exists (
        select 1 from public.order_pallets relation
        join public.dispatch_orders orders on orders.id = relation.order_id
        where relation.pallet_id = pallets.id and orders.driver_id = auth.uid()
      )
    )
  );

drop policy if exists movements_select on public.movements;
create policy movements_select on public.movements
  for select to authenticated using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and pallet_id in (
      select id from public.pallets where company_id = auth_company_id()
    ))
    or (auth_role() = 'driver_operator' and order_id in (
      select id from public.dispatch_orders where driver_id = auth.uid()
    ))
  );

drop policy if exists events_select_distributor on public.traceability_events;
drop policy if exists events_select_driver on public.traceability_events;
create policy events_select_driver on public.traceability_events
  for select to authenticated using (
    auth_role() = 'driver_operator'
    and order_id in (select id from public.dispatch_orders where driver_id = auth.uid())
  );

drop policy if exists distributors_select_operator on public.distributors;
drop policy if exists distributors_select on public.distributors;
create policy distributors_select on public.distributors
  for select to authenticated using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (
      auth_role() = 'driver_operator'
      and id in (select distributor_id from public.dispatch_orders where driver_id = auth.uid())
    )
  );

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated using (
    id = auth.uid()
    or (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
  );

drop policy if exists delivery_discrepancies_select on public.delivery_discrepancies;
create policy delivery_discrepancies_select on public.delivery_discrepancies
  for select to authenticated using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (auth_role() = 'driver_operator' and driver_id = auth.uid())
  );

-- La asignación se hace mediante RPC para mantener revocado el UPDATE directo
-- sobre dispatch_orders.
create or replace function public.assign_order_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.auth_company_id();
begin
  if auth.uid() is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.dispatch_orders orders
    where orders.id = p_order_id and orders.company_id = manager_company
      and orders.status in ('draft', 'validating', 'has_discrepancy', 'confirmed')
  ) then
    raise exception 'Orden no disponible' using errcode = 'P3901';
  end if;
  if not exists (
    select 1 from public.users driver
    where driver.id = p_driver_id and driver.company_id = manager_company
      and driver.role = 'driver_operator' and driver.revoked_at is null
  ) then
    raise exception 'Chofer no disponible' using errcode = 'P3902';
  end if;
  update public.dispatch_orders set driver_id = p_driver_id where id = p_order_id;
end;
$$;
revoke all on function public.assign_order_driver(uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_order_driver(uuid, uuid) to authenticated;

-- Listado seguro para el detalle mobile-first del chofer. No abre lectura
-- general de productos o lotes.
create or replace function public.get_order_delivery_pallets(p_order_id uuid)
returns table (
  pallet_id uuid, qr_code text, product_name text, product_sku text,
  batch_number text, quantity numeric, unit_of_measure text,
  delivery_outcome text, processed_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then return; end if;
  if not exists (
    select 1 from public.dispatch_orders orders
    where orders.id = p_order_id and orders.driver_id = auth.uid()
  ) then return; end if;

  return query
  select pallet.id, pallet.qr_code, product.name, product.sku,
    batch.batch_number, pallet.quantity, product.unit_of_measure::text,
    relation.delivery_outcome, relation.delivered_at
  from public.order_pallets relation
  join public.pallets pallet on pallet.id = relation.pallet_id
  join public.batches batch on batch.id = pallet.batch_id
  join public.products product on product.id = batch.product_id
  where relation.order_id = p_order_id and relation.expected = true
  order by pallet.qr_code;
end;
$$;
revoke all on function public.get_order_delivery_pallets(uuid) from public, anon, service_role;
grant execute on function public.get_order_delivery_pallets(uuid) to authenticated;

create unique index if not exists idx_events_single_delivery_confirmation
  on public.traceability_events(order_id, pallet_id, event_type)
  where event_type = 'delivery_confirmed';

create or replace function public.confirm_delivery_pallet(
  p_order_id uuid,
  p_qr_code text,
  p_discrepancy_type text default null
)
returns table (
  outcome text, pallet_id uuid, qr_code text, product_name text,
  product_sku text, batch_number text, registered_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
declare
  target_order public.dispatch_orders%rowtype;
  target_pallet public.pallets%rowtype;
  relation public.order_pallets%rowtype;
  destination_name text;
  found_product_name text;
  found_product_sku text;
  found_batch_number text;
  registered timestamptz := now();
  pending_count integer;
  has_difference boolean;
  normalized_difference text := p_discrepancy_type;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'driver_operator' then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if p_order_id is null or p_qr_code is null or btrim(p_qr_code) = '' or length(btrim(p_qr_code)) > 512 then
    return query select 'invalid_input', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if normalized_difference is not null and normalized_difference not in ('missing', 'surplus', 'damaged', 'wrong_order') then
    return query select 'invalid_discrepancy_type', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select orders.* into target_order from public.dispatch_orders orders
  where orders.id = p_order_id for update;
  if not found then
    return query select 'order_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if target_order.driver_id is distinct from auth.uid() then
    return query select 'forbidden', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if target_order.status not in ('confirmed', 'delivered', 'delivered_with_discrepancy') then
    return query select 'invalid_status', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select pallet.* into target_pallet from public.pallets pallet
  where pallet.qr_code = btrim(p_qr_code) for update;
  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select product.name, product.sku, batch.batch_number
    into found_product_name, found_product_sku, found_batch_number
  from public.batches batch join public.products product on product.id = batch.product_id
  where batch.id = target_pallet.batch_id;

  select item.* into relation from public.order_pallets item
  where item.order_id = p_order_id and item.pallet_id = target_pallet.id and item.expected = true
  for update;

  if not found then
    if target_order.status <> 'confirmed' then
      return query select 'invalid_status', target_pallet.id, target_pallet.qr_code,
        found_product_name, found_product_sku, found_batch_number, null::timestamptz;
      return;
    end if;
    normalized_difference := coalesce(normalized_difference, 'wrong_order');
    if normalized_difference not in ('surplus', 'wrong_order') then normalized_difference := 'wrong_order'; end if;
    insert into public.delivery_discrepancies (
      company_id, order_id, pallet_id, reported_qr_code, discrepancy_type, driver_id, created_at
    ) values (
      target_order.company_id, target_order.id, target_pallet.id, target_pallet.qr_code,
      normalized_difference, auth.uid(), registered
    ) on conflict (order_id, pallet_id, discrepancy_type) do nothing;
    if found then
      insert into public.traceability_events (
        company_id, pallet_id, order_id, event_type, user_id, details, created_at
      ) values (
        target_order.company_id, target_pallet.id, target_order.id, 'delivery_discrepancy',
        auth.uid(), jsonb_build_object('type', normalized_difference, 'qr_code', target_pallet.qr_code), registered
      );
      return query select case when normalized_difference = 'surplus' then 'surplus_recorded' else 'wrong_order' end,
        target_pallet.id, target_pallet.qr_code, found_product_name, found_product_sku, found_batch_number, registered;
    else
      return query select 'already_processed', target_pallet.id, target_pallet.qr_code,
        found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    end if;
    return;
  end if;

  if relation.delivery_outcome is not null then
    return query select 'already_processed', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, relation.delivered_at;
    return;
  end if;
  if target_order.status <> 'confirmed' then
    return query select 'invalid_status', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    return;
  end if;
  if normalized_difference in ('surplus', 'wrong_order') then
    return query select 'invalid_discrepancy_type', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    return;
  end if;
  if target_pallet.status <> 'in_transit' then
    return query select 'invalid_pallet_status', target_pallet.id, target_pallet.qr_code,
      found_product_name, found_product_sku, found_batch_number, null::timestamptz;
    return;
  end if;

  select recipient.name into destination_name from public.distributors recipient
  where recipient.id = target_order.distributor_id;

  update public.order_pallets item set
    delivery_outcome = case when normalized_difference is null then 'delivered' else normalized_difference end,
    delivered_at = registered,
    delivered_by = auth.uid()
  where item.order_id = p_order_id and item.pallet_id = target_pallet.id;

  update public.pallets pallet set
    status = case when normalized_difference is null then 'delivered'::public.pallet_status else 'delivery_discrepancy'::public.pallet_status end,
    current_location = case when normalized_difference = 'missing' then pallet.current_location else destination_name end
  where pallet.id = target_pallet.id;

  if normalized_difference is distinct from 'missing' then
    insert into public.movements (
      pallet_id, order_id, origin_location, destination_location, resulting_status, user_id, created_at
    ) values (
      target_pallet.id, target_order.id, target_pallet.current_location, destination_name,
      case when normalized_difference is null then 'delivered'::public.pallet_status else 'delivery_discrepancy'::public.pallet_status end,
      auth.uid(), registered
    );
  end if;

  insert into public.traceability_events (
    company_id, pallet_id, order_id, event_type, user_id, details, created_at
  ) values (
    target_order.company_id, target_pallet.id, target_order.id, 'delivery_confirmed', auth.uid(),
    jsonb_build_object('qr_code', target_pallet.qr_code, 'outcome', coalesce(normalized_difference, 'delivered'),
      'recipient_id', target_order.distributor_id), registered
  );

  if normalized_difference is not null then
    insert into public.delivery_discrepancies (
      company_id, order_id, pallet_id, reported_qr_code, discrepancy_type, driver_id, created_at
    ) values (
      target_order.company_id, target_order.id, target_pallet.id, target_pallet.qr_code,
      normalized_difference, auth.uid(), registered
    );
    insert into public.traceability_events (
      company_id, pallet_id, order_id, event_type, user_id, details, created_at
    ) values (
      target_order.company_id, target_pallet.id, target_order.id, 'delivery_discrepancy', auth.uid(),
      jsonb_build_object('type', normalized_difference, 'qr_code', target_pallet.qr_code), registered
    );
  end if;

  select count(*) into pending_count from public.order_pallets item
  where item.order_id = target_order.id and item.expected = true and item.delivery_outcome is null;
  if pending_count = 0 then
    select exists (
      select 1 from public.delivery_discrepancies difference where difference.order_id = target_order.id
    ) into has_difference;
    update public.dispatch_orders set
      status = case when has_difference then 'delivered_with_discrepancy'::public.order_status else 'delivered'::public.order_status end,
      delivered_at = registered,
      delivered_by = auth.uid()
    where id = target_order.id;
    if has_difference then
      insert into public.order_notifications (
        company_id, order_id, event_type, description, created_by, created_at
      ) values (
        target_order.company_id, target_order.id, 'delivery_closed_with_discrepancy',
        'La entrega fue cerrada con diferencias por el chofer asignado.', auth.uid(), registered
      );
    end if;
  end if;

  return query select 'delivered', target_pallet.id, target_pallet.qr_code,
    found_product_name, found_product_sku, found_batch_number, registered;
end;
$$;
revoke all on function public.confirm_delivery_pallet(uuid, text, text) from public, anon, service_role;
grant execute on function public.confirm_delivery_pallet(uuid, text, text) to authenticated;

-- Solicitudes y administración de operadores adaptadas al nuevo rol.
create or replace function public.get_company_operators()
returns table (
  user_id uuid, name text, email text, role public.user_role, revoked_at timestamptz,
  distributor_id uuid, distributor_name text,
  in_transit_orders integer, other_active_operators integer
)
language plpgsql stable security definer
set search_path = ''
as $$
declare caller_company uuid := public.active_manager_company_id();
begin
  if caller_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
  return query
  select u.id, u.name, u.email, u.role, u.revoked_at,
    null::uuid, null::text,
    (select count(*)::integer from public.dispatch_orders orders
      where orders.driver_id = u.id and orders.status = 'confirmed'),
    0::integer
  from public.users u
  where u.company_id = caller_company and u.role in ('warehouse_operator', 'driver_operator')
  order by u.revoked_at is not null, u.name, u.id;
end;
$$;

create or replace function public.approve_access_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid;
  request public.access_requests%rowtype;
  account auth.users%rowtype;
  declared_name text;
begin
  select u.company_id into manager_company from public.users u
    where u.id = auth.uid() and u.role = 'logistics_manager' and u.revoked_at is null for share;
  if manager_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
  select ar.* into request from public.access_requests ar
    where ar.id = p_request_id and ar.company_id = manager_company for update;
  if not found then raise exception 'Solicitud no disponible' using errcode = 'P3701'; end if;
  if request.status <> 'pending' then raise exception 'La solicitud ya no está pendiente' using errcode = 'P3702'; end if;
  if request.requested_role not in ('warehouse_operator', 'driver_operator') then
    raise exception 'Rol solicitado inválido' using errcode = 'P3703';
  end if;
  select a.* into account from auth.users a where a.id = request.user_id for share;
  if not found or account.email is null or btrim(account.email) = '' then
    raise exception 'Cuenta sin email disponible' using errcode = 'P3704';
  end if;
  if jsonb_typeof(account.raw_user_meta_data -> 'name') is distinct from 'string' then
    raise exception 'El solicitante debe completar su nombre' using errcode = 'P3705';
  end if;
  declared_name := btrim(account.raw_user_meta_data ->> 'name');
  if declared_name = '' or char_length(declared_name) > 100 then
    raise exception 'El solicitante debe completar un nombre válido' using errcode = 'P3705';
  end if;
  if exists (select 1 from public.users u where u.id = request.user_id) then
    raise exception 'El usuario ya tiene perfil operativo' using errcode = 'P3706';
  end if;
  insert into public.users (id, company_id, name, email, role)
    values (request.user_id, request.company_id, declared_name, account.email, request.requested_role::public.user_role);
  update public.access_requests set status = 'approved' where id = request.id;
end;
$$;

create or replace function public.revoke_operator_access(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
  operator public.users%rowtype;
begin
  if manager_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
  select u.* into operator from public.users u
    where u.id = p_user_id and u.company_id = manager_company for update;
  if not found then raise exception 'Operador no disponible' using errcode = 'P3821'; end if;
  if operator.role not in ('warehouse_operator', 'driver_operator') then
    raise exception 'Solo se revoca el acceso de operadores' using errcode = 'P3822';
  end if;
  if operator.revoked_at is not null then raise exception 'El acceso ya está revocado' using errcode = 'P3823'; end if;
  update public.users set revoked_at = now() where id = operator.id;
end;
$$;

create or replace function public.restore_operator_access(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
  operator public.users%rowtype;
begin
  if manager_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
  select u.* into operator from public.users u
    where u.id = p_user_id and u.company_id = manager_company for update;
  if not found then raise exception 'Operador no disponible' using errcode = 'P3821'; end if;
  if operator.role not in ('warehouse_operator', 'driver_operator') then
    raise exception 'Solo se restaura el acceso de operadores' using errcode = 'P3822';
  end if;
  if operator.revoked_at is null then raise exception 'El acceso no está revocado' using errcode = 'P3824'; end if;
  update public.users set revoked_at = null where id = operator.id;
end;
$$;

revoke all on function public.get_company_operators() from public, anon, service_role;
grant execute on function public.get_company_operators() to authenticated;
revoke all on function public.approve_access_request(uuid) from public, anon, service_role;
grant execute on function public.approve_access_request(uuid) to authenticated;
revoke all on function public.revoke_operator_access(uuid) from public, anon, service_role;
grant execute on function public.revoke_operator_access(uuid) to authenticated;
revoke all on function public.restore_operator_access(uuid) from public, anon, service_role;
grant execute on function public.restore_operator_access(uuid) to authenticated;
