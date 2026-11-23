-- TRZ-52 (redefinida): el chofer ve el remito de las órdenes que tiene asignadas, desde "Mis entregas", para
-- saber qué tiene que entregar y contrastarlo con lo que recibe el destinatario. Solo lectura.
-- El destinatario no tiene cuenta en TrazFlow: ve el remito impreso o en PDF que le entrega el chofer.

create policy dispatch_notes_select_driver on public.dispatch_notes
  for select to authenticated
  using (
    (select public.auth_role()) = 'driver_operator'
    and company_id = (select public.auth_company_id())
    and exists (
      select 1 from public.dispatch_orders orders
      where orders.id = dispatch_notes.order_id and orders.driver_id = (select auth.uid())
    )
  );
