-- ============================================================================
-- Migración: 20260831230634_add_dispatch_order_details.sql
-- ============================================================================
-- US1 (Sprint 1): crear una orden de despacho.
--
-- 1) dispatch_orders todavía no tiene fecha estimada de despacho ni
--    observaciones. No hay filas cargadas en la tabla, así que se puede
--    agregar "estimated_dispatch_date" como NOT NULL sin default.
--
-- 2) "distributors" tiene RLS activado (migración 0001) pero nunca se le
--    definió una policy: sin policies, RLS deniega todo acceso, incluso al
--    dueño de la fila. Sin esto, el selector de distribuidor de US1 no
--    podría leer la tabla. Se agrega la policy mínima acotada a la empresa,
--    mismo criterio que "products_company".
-- ============================================================================

alter table dispatch_orders
  add column estimated_dispatch_date date not null,
  add column notes text;

create policy distributors_select on distributors
  for select using (company_id = auth_company_id());
