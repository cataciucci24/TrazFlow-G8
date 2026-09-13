-- La interfaz solo ofrece eliminar pallets aún disponibles. Esta policy vuelve
-- la regla exigible también desde la base de datos, incluso fuera de la UI.
create policy pallets_delete_logistics_in_warehouse on pallets
  for delete using (
    auth_role() = 'logistics_manager'
    and company_id = auth_company_id()
    and status = 'in_warehouse'
  );
