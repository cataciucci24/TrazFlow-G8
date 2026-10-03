-- Los pallets históricos conservan el código que ya está en sus etiquetas.
-- La restricción UNIQUE existente garantiza que no se persistan duplicados.
alter table public.pallets
  alter column qr_code set default ('PAL-' || gen_random_uuid()::text);

create function public.protect_pallet_qr_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.qr_code is distinct from old.qr_code then
    raise exception 'El código QR de un pallet no se puede modificar.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_pallets_protect_qr_code
before update on public.pallets
for each row execute function public.protect_pallet_qr_code();
