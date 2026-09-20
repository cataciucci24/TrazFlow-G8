-- US12: el stock de cada distribuidora se informa con cantidad y unidad.
-- Las filas existentes se interpretaban como unidades, por eso ese es el valor por defecto.
-- current_stock pasa a numeric para admitir cantidades decimales (por ejemplo, kilogramos).
alter table public.distributor_product_stocks
  alter column current_stock type numeric(12, 2),
  add column unit_of_measure text not null default 'unidades',
  add constraint distributor_product_stocks_unit_of_measure_allowed check (
    unit_of_measure in ('unidades', 'cajas', 'kilogramos')
  );

comment on column public.distributor_product_stocks.unit_of_measure is
  'Unidad de current_stock y daily_consumption: unidades, cajas o kilogramos.';
