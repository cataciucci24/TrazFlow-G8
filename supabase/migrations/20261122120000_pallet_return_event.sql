-- En una migración separada: PostgreSQL exige confirmar el nuevo valor antes de usarlo.
alter type public.event_type add value if not exists 'pallet_returned';
