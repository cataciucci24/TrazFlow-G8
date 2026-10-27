-- TRZ-65: regla con la que el ERP elige qué lote sale primero (FIFO, LIFO o por vencimiento).
--
-- La sincronización la lee del ERP (ErpClient.getBatchPickingPolicy) y la guarda acá con
-- erp_set_batch_picking_policy. TrazFlow la usa solo para sugerir el orden de los pallets al asociarlos a una
-- orden: no bloquea nada ni decide por el ERP. Sin fila, la app asume FIFO.

create table public.erp_company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  batch_picking_policy text not null default 'fifo' check (batch_picking_policy in ('fifo', 'lifo', 'expiry')),
  batch_picking_policy_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.erp_company_settings enable row level security;
revoke all on public.erp_company_settings from anon, authenticated;
grant select on public.erp_company_settings to authenticated, service_role;

create policy "erp settings: company reads" on public.erp_company_settings
  for select to authenticated
  using (
    company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
  );

-- La llama la sincronización: logística de la empresa, o service_role (cron de TRZ-104) para cualquier empresa.
create function public.erp_set_batch_picking_policy(p_company_id uuid, p_policy text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_company_id is null or p_policy is null or p_policy not in ('fifo', 'lifo', 'expiry') then
    raise exception 'Política de salida inválida: %.', coalesce(p_policy, '(vacía)') using errcode = '22023';
  end if;
  if (select auth.role()) is distinct from 'service_role' and (
       auth.uid() is null
       or public.auth_role() is distinct from 'logistics_manager'
       or public.auth_company_id() is distinct from p_company_id) then
    raise exception 'Solo logística de la empresa puede guardar la política del ERP.' using errcode = '42501';
  end if;

  insert into public.erp_company_settings (company_id, batch_picking_policy, batch_picking_policy_synced_at, updated_at)
  values (p_company_id, p_policy, now(), now())
  on conflict (company_id) do update
    set batch_picking_policy = excluded.batch_picking_policy,
        batch_picking_policy_synced_at = excluded.batch_picking_policy_synced_at,
        updated_at = now();
end;
$$;

revoke all on function public.erp_set_batch_picking_policy(uuid, text) from public, anon;
grant execute on function public.erp_set_batch_picking_policy(uuid, text) to authenticated, service_role;
