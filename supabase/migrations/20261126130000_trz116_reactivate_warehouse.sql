-- Reactivation is restricted to manual warehouses in the caller's company.
create function public.reactivate_manual_warehouse(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid := public.auth_company_id(); v_warehouse public.warehouses%rowtype;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede administrar depósitos.' using errcode = '42501';
  end if;
  select * into v_warehouse from public.warehouses where company_id = v_company and code = p_code for update;
  if not found then raise exception 'Depósito inexistente.' using errcode = 'P0002'; end if;
  if v_warehouse.source_system <> 'trazflow' then
    raise exception 'El depósito está administrado por el ERP.' using errcode = '42501';
  end if;
  update public.warehouses set active = true where id = v_warehouse.id;
end;
$$;
revoke all on function public.reactivate_manual_warehouse(text) from public, anon, service_role;
grant execute on function public.reactivate_manual_warehouse(text) to authenticated;
