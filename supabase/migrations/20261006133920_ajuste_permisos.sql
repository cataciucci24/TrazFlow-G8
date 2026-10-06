-- ============================================================================
-- Ajuste de permisos: escrituras por rol, referencias dentro de la empresa,
-- historial de trazabilidad inmutable y autor de eventos asignado por la base.
--
-- confirm_dispatch_order, validate_order_pallet, receive_order_pallet y
-- dissociate_pallet_from_order son SECURITY DEFINER, por lo que no dependen de
-- las policies ni de los privilegios que se ajustan acá.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- dispatch_orders: las transiciones de estado de la orden se hacen solo vía
-- funciones de base.
-- ----------------------------------------------------------------------------
drop policy if exists orders_update_warehouse_confirm on public.dispatch_orders;
revoke update on public.dispatch_orders from authenticated;

-- ----------------------------------------------------------------------------
-- order_pallets: la validación de un pallet se registra solo escaneando su QR
-- (validate_order_pallet).
-- ----------------------------------------------------------------------------
drop policy if exists order_pallets_update_warehouse on public.order_pallets;
revoke update on public.order_pallets from authenticated;

-- ----------------------------------------------------------------------------
-- products / batches: lectura para toda la empresa; alta, modificación y baja
-- solo para el responsable logístico.
-- ----------------------------------------------------------------------------
drop policy if exists products_company on public.products;

drop policy if exists products_select_company on public.products;
create policy products_select_company on public.products
  for select to authenticated
  using (company_id = auth_company_id());

drop policy if exists products_insert_manager on public.products;
create policy products_insert_manager on public.products
  for insert to authenticated
  with check (auth_role() = 'logistics_manager' and company_id = auth_company_id());

drop policy if exists products_update_manager on public.products;
create policy products_update_manager on public.products
  for update to authenticated
  using (auth_role() = 'logistics_manager' and company_id = auth_company_id())
  with check (auth_role() = 'logistics_manager' and company_id = auth_company_id());

drop policy if exists products_delete_manager on public.products;
create policy products_delete_manager on public.products
  for delete to authenticated
  using (auth_role() = 'logistics_manager' and company_id = auth_company_id());

drop policy if exists batches_company on public.batches;

drop policy if exists batches_select_company on public.batches;
create policy batches_select_company on public.batches
  for select to authenticated
  using (product_id in (select p.id from public.products p where p.company_id = auth_company_id()));

drop policy if exists batches_insert_manager on public.batches;
create policy batches_insert_manager on public.batches
  for insert to authenticated
  with check (
    auth_role() = 'logistics_manager'
    and product_id in (select p.id from public.products p where p.company_id = auth_company_id())
  );

drop policy if exists batches_update_manager on public.batches;
create policy batches_update_manager on public.batches
  for update to authenticated
  using (
    auth_role() = 'logistics_manager'
    and product_id in (select p.id from public.products p where p.company_id = auth_company_id())
  )
  with check (
    auth_role() = 'logistics_manager'
    and product_id in (select p.id from public.products p where p.company_id = auth_company_id())
  );

drop policy if exists batches_delete_manager on public.batches;
create policy batches_delete_manager on public.batches
  for delete to authenticated
  using (
    auth_role() = 'logistics_manager'
    and product_id in (select p.id from public.products p where p.company_id = auth_company_id())
  );

-- ----------------------------------------------------------------------------
-- pallets: los crea el responsable logístico, en depósito y con un lote de su
-- empresa. El código QR lo genera siempre la base.
-- ----------------------------------------------------------------------------
drop policy if exists pallets_write on public.pallets;

drop policy if exists pallets_insert_manager on public.pallets;
create policy pallets_insert_manager on public.pallets
  for insert to authenticated
  with check (
    auth_role() = 'logistics_manager'
    and company_id = auth_company_id()
    and status = 'in_warehouse'
    and exists (
      select 1 from public.batches b
      join public.products p on p.id = b.product_id
      where b.id = batch_id and p.company_id = auth_company_id()
    )
  );

revoke insert on public.pallets from authenticated;
grant insert (company_id, batch_id, quantity, unit_of_measure, current_location)
  on public.pallets to authenticated;

-- ----------------------------------------------------------------------------
-- dispatch_orders: una orden nueva se crea en borrador, a nombre de quien la
-- crea y hacia un distribuidor de la misma empresa.
-- ----------------------------------------------------------------------------
drop policy if exists orders_insert on public.dispatch_orders;
create policy orders_insert on public.dispatch_orders
  for insert to authenticated
  with check (
    auth_role() = 'logistics_manager'
    and company_id = auth_company_id()
    and created_by = auth.uid()
    and status = 'draft'
    and exists (
      select 1 from public.distributors d
      where d.id = distributor_id and d.company_id = auth_company_id()
    )
  );

-- ----------------------------------------------------------------------------
-- order_pallets: quitar un pallet de una orden se hace solo vía
-- dissociate_pallet_from_order.
-- ----------------------------------------------------------------------------
drop policy if exists order_pallets_delete_manager on public.order_pallets;
revoke delete on public.order_pallets from authenticated;

-- ----------------------------------------------------------------------------
-- El historial de trazabilidad se conserva: un pallet, una orden o una empresa
-- con eventos o movimientos no se pueden eliminar. Las FKs se buscan por
-- columna para no depender de sus nombres.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and (
        (c.conrelid = 'public.traceability_events'::regclass and a.attname in ('pallet_id', 'order_id', 'company_id'))
        or (c.conrelid = 'public.movements'::regclass and a.attname in ('pallet_id', 'order_id'))
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end;
$$;

alter table public.traceability_events
  add constraint traceability_events_pallet_id_fkey
    foreign key (pallet_id) references public.pallets(id) on delete restrict,
  add constraint traceability_events_order_id_fkey
    foreign key (order_id) references public.dispatch_orders(id) on delete restrict,
  add constraint traceability_events_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete restrict;

alter table public.movements
  add constraint movements_pallet_id_fkey
    foreign key (pallet_id) references public.pallets(id) on delete restrict,
  add constraint movements_order_id_fkey
    foreign key (order_id) references public.dispatch_orders(id) on delete restrict;

-- Eventos y movimientos solo admiten inserciones desde la API.
revoke update, delete, truncate, references, trigger
  on public.traceability_events from authenticated, anon;
revoke update, delete, truncate, references, trigger
  on public.movements from authenticated, anon;

-- ----------------------------------------------------------------------------
-- Los eventos de trazabilidad son inmutables: UPDATE, DELETE y TRUNCATE se
-- rechazan para cualquier rol.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los eventos de trazabilidad son inmutables (% no permitido).', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_events_immutable on public.traceability_events;
create trigger trg_events_immutable
  before update or delete on public.traceability_events
  for each row execute function public.prevent_event_mutation();

drop trigger if exists trg_events_no_truncate on public.traceability_events;
create trigger trg_events_no_truncate
  before truncate on public.traceability_events
  for each statement execute function public.prevent_event_mutation();

-- ----------------------------------------------------------------------------
-- El autor y la fecha de cada evento los asigna la base: el usuario del
-- request (auth.uid(), disponible también dentro de las funciones SECURITY
-- DEFINER) y now(). Sin usuario en el request (migraciones, service_role) se
-- conservan los valores recibidos; desde la API se exige un usuario.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_event_author()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    new.user_id := v_uid;
    new.created_at := now();
  elsif current_user in ('authenticated', 'anon') then
    raise exception 'Un evento requiere un usuario autenticado.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_event_author() from public, anon, authenticated;
revoke all on function public.prevent_event_mutation() from public, anon, authenticated;

drop trigger if exists trg_events_enforce_author on public.traceability_events;
create trigger trg_events_enforce_author
  before insert on public.traceability_events
  for each row execute function public.enforce_event_author();

drop policy if exists events_insert_authorized_roles on public.traceability_events;
create policy events_insert_authorized_roles on public.traceability_events
  for insert to authenticated
  with check (
    company_id = auth_company_id()
    and auth_role() in ('logistics_manager', 'warehouse_operator')
    and user_id = auth.uid()
  );
