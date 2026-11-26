-- A company with a configured ERP receives warehouses through synchronization.
-- Restrict only the manual RPC; ERP sync and onboarding keep their existing paths.
create or replace function public.manage_manual_warehouse(p_action text, p_code text, p_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid := public.auth_company_id(); v_warehouse public.warehouses%rowtype;
begin
  if auth.uid() is null or v_company is null or public.auth_role() is distinct from 'logistics_manager' then
    raise exception 'Solo logística puede administrar depósitos.' using errcode = '42501';
  end if;
  if p_code is null or p_code !~ '^[A-Z0-9][A-Z0-9_-]{0,39}$' then
    raise exception 'Código de depósito inválido.' using errcode = '22023';
  end if;
  if p_action in ('create', 'rename') and (p_name is null or pg_catalog.length(pg_catalog.btrim(p_name)) not between 1 and 140) then
    raise exception 'Nombre de depósito inválido.' using errcode = '22023';
  end if;
  if p_action = 'create' then
    if public.erp_company_provider(v_company) is not null then
      raise exception 'Los depósitos se incorporan desde el ERP de la empresa.' using errcode = 'TF116';
    end if;
    insert into public.warehouses(company_id, code, name) values (v_company, p_code, pg_catalog.btrim(p_name));
    return;
  end if;
  if p_action not in ('rename', 'deactivate') or p_action is null then
    raise exception 'Operación inválida.' using errcode = '22023';
  end if;
  select * into v_warehouse from public.warehouses where company_id = v_company and code = p_code for update;
  if not found then raise exception 'Depósito inexistente.' using errcode = 'P0002'; end if;
  if v_warehouse.source_system <> 'trazflow' then
    raise exception 'El depósito está administrado por el ERP.' using errcode = '42501';
  end if;
  if p_action = 'rename' then
    update public.warehouses set name = pg_catalog.btrim(p_name) where id = v_warehouse.id;
  else
    if exists (select 1 from public.pallets p where p.company_id = v_company and p.warehouse_code = p_code
               and p.status in ('in_warehouse', 'assigned')) then
      raise exception 'El depósito contiene pallets en stock.' using errcode = '23514';
    end if;
    update public.warehouses set active = false where id = v_warehouse.id;
  end if;
end;
$$;
