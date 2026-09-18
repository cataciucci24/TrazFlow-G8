-- No se infiere la cantidad de un pallet a partir del total de su lote.
-- Los NULL permiten conservar los pallets históricos pendientes de completar.
alter table public.pallets
  add column quantity numeric,
  add column unit_of_measure text,
  add constraint pallets_quantity_positive check (
    quantity > 0 and quantity < 'Infinity'::numeric
  ),
  add constraint pallets_unit_of_measure_allowed check (
    unit_of_measure in ('unidades', 'cajas', 'kilogramos')
  ),
  add constraint pallets_quantity_unit_pair check (
    (quantity is null) = (unit_of_measure is null)
  );

comment on column public.pallets.quantity is
  'Cantidad propia del pallet. NULL indica un pallet histórico sin definir.';
comment on column public.pallets.unit_of_measure is
  'Unidad de la cantidad del pallet: unidades, cajas o kilogramos.';

-- Cambio futuro: retirar batches.quantity tras revisar sus demás consumidores.
-- Esta migración no modifica sus valores ni sus restricciones.
