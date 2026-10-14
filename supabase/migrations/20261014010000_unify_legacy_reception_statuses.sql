-- El flujo vigente confirma la entrega con chofer. Los estados de recepción
-- anteriores describían el mismo cierre operativo y se conservan solo como
-- valores históricos del enum para no invalidar datos ni migraciones previas.
update public.pallets
set status = case status
  when 'received' then 'delivered'::public.pallet_status
  when 'discrepancy' then 'delivery_discrepancy'::public.pallet_status
  else status
end
where status in ('received', 'discrepancy');

update public.movements
set resulting_status = case resulting_status
  when 'received' then 'delivered'::public.pallet_status
  when 'discrepancy' then 'delivery_discrepancy'::public.pallet_status
  else resulting_status
end
where resulting_status in ('received', 'discrepancy');
