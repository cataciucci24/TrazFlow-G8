-- Envuelve auth.uid() en (select ...) para que Postgres lo evalúe una sola vez
-- por consulta en lugar de por fila (lint 0003_auth_rls_initplan de Supabase).
-- La lógica de cada política no cambia.

alter policy "insert own pending request" on public.access_requests
  with check (user_id = (select auth.uid()) and status = 'pending');

alter policy "read own request" on public.access_requests
  using (user_id = (select auth.uid()));

alter policy orders_insert on public.dispatch_orders
  with check (
    auth_role() = 'logistics_manager'
    and company_id = auth_company_id()
    and created_by = (select auth.uid())
    and status = 'draft'
    and exists (
      select 1 from public.distributors d
      where d.id = distributor_id and d.company_id = auth_company_id()
    )
  );

alter policy orders_select on public.dispatch_orders
  using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (auth_role() = 'driver_operator' and driver_id = (select auth.uid()))
  );

alter policy order_pallets_select on public.order_pallets
  using (
    exists (
      select 1 from public.dispatch_orders orders
      where orders.id = order_id
        and (
          (auth_role() in ('logistics_manager', 'warehouse_operator') and orders.company_id = auth_company_id())
          or (auth_role() = 'driver_operator' and orders.driver_id = (select auth.uid()))
        )
    )
  );

alter policy pallets_select on public.pallets
  using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (
      auth_role() = 'driver_operator'
      and exists (
        select 1 from public.order_pallets relation
        join public.dispatch_orders orders on orders.id = relation.order_id
        where relation.pallet_id = pallets.id and orders.driver_id = (select auth.uid())
      )
    )
  );

alter policy movements_select on public.movements
  using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and pallet_id in (
      select id from public.pallets where company_id = auth_company_id()
    ))
    or (auth_role() = 'driver_operator' and order_id in (
      select id from public.dispatch_orders where driver_id = (select auth.uid())
    ))
  );

alter policy events_insert_authorized_roles on public.traceability_events
  with check (
    company_id = auth_company_id()
    and auth_role() in ('logistics_manager', 'warehouse_operator')
    and user_id = (select auth.uid())
  );

alter policy events_select_driver on public.traceability_events
  using (
    auth_role() = 'driver_operator'
    and order_id in (select id from public.dispatch_orders where driver_id = (select auth.uid()))
  );

alter policy distributors_select on public.distributors
  using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (
      auth_role() = 'driver_operator'
      and id in (select distributor_id from public.dispatch_orders where driver_id = (select auth.uid()))
    )
  );

alter policy users_select on public.users
  using (
    id = (select auth.uid())
    or (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
  );

alter policy delivery_discrepancies_select on public.delivery_discrepancies
  using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (auth_role() = 'driver_operator' and driver_id = (select auth.uid()))
  );
