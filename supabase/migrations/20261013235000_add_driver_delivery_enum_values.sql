-- US-ERP-01 / US-OPS-07: valores nuevos separados del resto del esquema.
-- PostgreSQL exige confirmar ALTER TYPE antes de usar los valores en DDL.

alter type public.user_role add value if not exists 'driver_operator';

alter type public.order_status add value if not exists 'delivered';
alter type public.order_status add value if not exists 'delivered_with_discrepancy';

alter type public.pallet_status add value if not exists 'delivered';
alter type public.pallet_status add value if not exists 'delivery_discrepancy';

alter type public.event_type add value if not exists 'delivery_confirmed';
alter type public.event_type add value if not exists 'delivery_discrepancy';
