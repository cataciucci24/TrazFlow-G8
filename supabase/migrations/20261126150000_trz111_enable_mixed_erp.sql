-- TRZ-111 ola 2: contrato/adaptadores v2 integrados con productores por empresa.
-- Los eventos v1 pendientes conservan payload e identidad. Solo se retira TM111;
-- la confirmación sigue exigiendo contenido vigente y validado por ítem.
drop trigger trg_guard_mixed_erp_order on public.order_pallets;
drop function public.guard_mixed_erp_order();

create or replace function public.guard_dispatch_content()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if exists (select 1 from public.order_pallets op where op.order_id = new.id and op.expected
      and ((jsonb_array_length(op.expected_items) > 1 and op.dispatch_items is distinct from op.expected_items)
        or public.pallet_content_snapshot(op.pallet_id) <> op.expected_items)) then
      raise exception 'Hay ítems pendientes de validar o el contenido cambió. Volvé a escanear.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dispatch_content() from public, anon, authenticated, service_role;
