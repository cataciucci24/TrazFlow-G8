-- ============================================================================
-- Migración: restrict_distributor_visibility
-- ============================================================================
-- Contexto:
--   Las políticas de lectura de dispatch_orders, order_pallets, pallets,
--   movements y traceability_events permitían ver todo lo de la empresa a
--   cualquier usuario de esa empresa, incluido el distributor_operator. Como
--   todas las distribuidoras pertenecen a la misma empresa, un operador veía las
--   órdenes (y sus pallets, movimientos y eventos) de las demás distribuidoras.
--
-- Cambio:
--   El acceso "por empresa" queda solo para logistics_manager y
--   warehouse_operator. El distributor_operator solo ve lo asociado a las
--   órdenes de su distribuidora (operates_for_distributor), que ya estaba
--   contemplado en cada política.
--
-- No cambia escrituras ni las funciones SECURITY DEFINER (recepción, etc.).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- dispatch_orders
-- ----------------------------------------------------------------------------
drop policy orders_select on dispatch_orders;

create policy orders_select on dispatch_orders
  for select using (
    (
      auth_role() in ('logistics_manager', 'warehouse_operator')
      and company_id = auth_company_id()
    )
    or operates_for_distributor(distributor_id)
  );

-- ----------------------------------------------------------------------------
-- order_pallets
-- ----------------------------------------------------------------------------
drop policy order_pallets_select on order_pallets;

create policy order_pallets_select on order_pallets
  for select using (
    order_id in (
      select dispatch_orders.id
      from dispatch_orders
      where (
        auth_role() in ('logistics_manager', 'warehouse_operator')
        and dispatch_orders.company_id = auth_company_id()
      )
      or operates_for_distributor(dispatch_orders.distributor_id)
    )
  );

-- ----------------------------------------------------------------------------
-- pallets
-- ----------------------------------------------------------------------------
drop policy pallets_select on pallets;

create policy pallets_select on pallets
  for select using (
    (
      auth_role() in ('logistics_manager', 'warehouse_operator')
      and company_id = auth_company_id()
    )
    or id in (
      select op.pallet_id
      from order_pallets op
      join dispatch_orders o on o.id = op.order_id
      where operates_for_distributor(o.distributor_id)
    )
  );

-- ----------------------------------------------------------------------------
-- movements
-- ----------------------------------------------------------------------------
drop policy movements_select on movements;

create policy movements_select on movements
  for select using (
    (
      auth_role() in ('logistics_manager', 'warehouse_operator')
      and pallet_id in (
        select pallets.id from pallets where pallets.company_id = auth_company_id()
      )
    )
    or order_id in (
      select dispatch_orders.id
      from dispatch_orders
      where operates_for_distributor(dispatch_orders.distributor_id)
    )
  );

-- ----------------------------------------------------------------------------
-- traceability_events
-- events_select_distributor (US6) ya cubre al distribuidor para los eventos de
-- las órdenes de su distribuidora.
-- ----------------------------------------------------------------------------
drop policy events_select on traceability_events;

create policy events_select on traceability_events
  for select using (
    auth_role() in ('logistics_manager', 'warehouse_operator')
    and company_id = auth_company_id()
  );
