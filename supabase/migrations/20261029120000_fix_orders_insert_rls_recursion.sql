-- Crear una orden manual fallaba con `infinite recursion detected in policy for relation "dispatch_orders"`.
--
-- orders_insert (dispatch_orders) valida que el distribuidor sea de la empresa con un EXISTS sobre distributors,
-- y distributors_select, para el chofer, mira dispatch_orders (los distribuidores de sus órdenes). Postgres expande
-- las políticas de las dos tablas y detecta que dispatch_orders se vuelve a referenciar a sí misma.
--
-- Se corta el ciclo: la rama del chofer de distributors_select lee sus órdenes con una función SECURITY DEFINER,
-- que no vuelve a aplicar las políticas de dispatch_orders. La regla es la misma: el chofer ve los distribuidores de
-- las órdenes que tiene asignadas.

create or replace function public.driver_distributor_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct orders.distributor_id
  from public.dispatch_orders orders
  where orders.driver_id = (select auth.uid())
    and orders.company_id = public.auth_company_id();
$$;

revoke all on function public.driver_distributor_ids() from public, anon;
grant execute on function public.driver_distributor_ids() to authenticated;

alter policy distributors_select on public.distributors
  using (
    (auth_role() in ('logistics_manager', 'warehouse_operator') and company_id = auth_company_id())
    or (
      auth_role() = 'driver_operator'
      and id in (select public.driver_distributor_ids())
    )
  );
