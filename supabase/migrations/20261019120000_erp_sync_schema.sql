-- US-ERP-03: sincronización de maestros y órdenes desde el ERP.
-- Cada entidad sincronizada guarda de dónde vino (source_system), su id en el ERP (external_id)
-- y cuándo la tocó la última sincronización (synced_at). La clave de upsert es siempre
-- (company_id, external_id): nunca el nombre visible ni el SKU.

-- batches no tenía empresa propia: se completa desde el producto y un trigger la mantiene,
-- así el upsert de lotes también es por (company_id, external_id).
alter table public.batches
  add column company_id uuid references public.companies(id) on delete cascade;
update public.batches batch set company_id = product.company_id
  from public.products product where product.id = batch.product_id;
alter table public.batches alter column company_id set not null;
create index idx_batches_company on public.batches(company_id);

create function public.set_batch_company()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- La empresa del lote es siempre la de su producto: se ignora la que mande el cliente.
  select product.company_id into new.company_id from public.products product where product.id = new.product_id;
  return new;
end;
$$;
create trigger trg_batches_set_company before insert or update of product_id, company_id
  on public.batches for each row execute function public.set_batch_company();
revoke all on function public.set_batch_company() from public, anon, authenticated;

alter table public.products
  add column external_id text,
  add column source_system text not null default 'trazflow',
  add column synced_at timestamptz,
  add column external_active boolean;
alter table public.batches
  add column external_id text,
  add column source_system text not null default 'trazflow',
  add column synced_at timestamptz,
  add column external_active boolean;
alter table public.pallets
  add column external_id text,
  add column source_system text not null default 'trazflow',
  add column synced_at timestamptz;
alter table public.distributors
  add column external_id text,
  add column source_system text not null default 'trazflow',
  add column synced_at timestamptz;
alter table public.dispatch_orders
  add column external_id text,
  add column source_system text not null default 'trazflow',
  add column synced_at timestamptz;

do $$
declare
  synced_table text;
begin
  foreach synced_table in array array['products', 'batches', 'pallets', 'distributors', 'dispatch_orders'] loop
    execute format(
      'alter table public.%1$I
         add constraint %1$s_source_system_check check (source_system in (''trazflow'', ''erp'')),
         add constraint %1$s_external_id_source_check check ((source_system = ''trazflow'') = (external_id is null)),
         add constraint %1$s_external_id_format_check check (external_id is null or length(btrim(external_id)) between 1 and 300)',
      synced_table);
    execute format(
      'create unique index %1$s_company_external_id_key on public.%1$I (company_id, external_id) where external_id is not null',
      synced_table);
  end loop;
end;
$$;

-- Las columnas de sincronización solo las escriben las RPC de sincronización (SECURITY DEFINER). Además,
-- lo que es dato del ERP (TG_ARGV) no se edita ni se borra desde la API: el ERP es la fuente de verdad y la
-- próxima sincronización lo volvería a pisar. El estado operativo (status, ubicación, etc.) sigue libre.
-- SECURITY INVOKER a propósito: current_user distingue la API de las RPC, como guard_direct_pallet_status.
create function public.guard_erp_synced_row()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  sync_columns constant text[] := array['external_id', 'source_system', 'synced_at', 'external_active'];
  new_row jsonb;
  old_row jsonb;
  column_name text;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.source_system = 'erp' then
      raise exception 'Los datos importados del ERP no se pueden eliminar desde TrazFlow.' using errcode = '42501';
    end if;
    return old;
  end if;

  new_row := to_jsonb(new);
  if tg_op = 'INSERT' then
    if new.external_id is not null or new.source_system <> 'trazflow' or new.synced_at is not null
       or coalesce(new_row->'external_active', 'null'::jsonb) <> 'null'::jsonb then
      raise exception 'Solo la sincronización con el ERP puede marcar un registro como importado.' using errcode = '42501';
    end if;
    return new;
  end if;

  old_row := to_jsonb(old);
  foreach column_name in array sync_columns loop
    if new_row->column_name is distinct from old_row->column_name then
      raise exception 'Solo la sincronización con el ERP puede modificar %.', column_name using errcode = '42501';
    end if;
  end loop;
  if old.source_system = 'erp' then
    foreach column_name in array tg_argv loop
      if new_row->column_name is distinct from old_row->column_name then
        raise exception 'El dato % viene del ERP y no se puede modificar desde TrazFlow.', column_name using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_erp_synced_row() from public, anon, authenticated;

create trigger trg_products_guard_erp before insert or update or delete on public.products
  for each row execute function public.guard_erp_synced_row('sku', 'name', 'unit_of_measure');
create trigger trg_batches_guard_erp before insert or update or delete on public.batches
  for each row execute function public.guard_erp_synced_row('product_id', 'batch_number', 'expiration_date');
create trigger trg_pallets_guard_erp before insert or update or delete on public.pallets
  for each row execute function public.guard_erp_synced_row('batch_id', 'quantity');
create trigger trg_distributors_guard_erp before insert or update or delete on public.distributors
  for each row execute function public.guard_erp_synced_row('name');
create trigger trg_dispatch_orders_guard_erp before insert or update or delete on public.dispatch_orders
  for each row execute function public.guard_erp_synced_row('distributor_id', 'estimated_dispatch_date');

-- Correspondencia depósito del ERP → depósito de TrazFlow. Hoy hay un solo depósito por empresa
-- (warehouse_locations.warehouse_code = 'DEP-01'); la tabla deja lugar para más.
create table public.erp_warehouse_mappings (
  company_id uuid not null references public.companies(id) on delete restrict,
  external_warehouse_id text not null check (length(btrim(external_warehouse_id)) between 1 and 300),
  warehouse_code text not null default 'DEP-01' check (warehouse_code = 'DEP-01'),
  created_by uuid not null default auth.uid() references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id, external_warehouse_id)
);
alter table public.erp_warehouse_mappings enable row level security;
revoke all on public.erp_warehouse_mappings from anon, authenticated;
grant select, delete on public.erp_warehouse_mappings to authenticated;
grant insert (company_id, external_warehouse_id) on public.erp_warehouse_mappings to authenticated;
create policy erp_warehouse_mappings_select on public.erp_warehouse_mappings for select to authenticated
  using (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager');
create policy erp_warehouse_mappings_insert on public.erp_warehouse_mappings for insert to authenticated
  with check (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager'
    and created_by = (select auth.uid()));
create policy erp_warehouse_mappings_delete on public.erp_warehouse_mappings for delete to authenticated
  using (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager');

-- Auditoría de cada ejecución. Solo la escriben las RPC erp_sync_*; logística la lee.
create table public.erp_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  triggered_by uuid not null references public.users(id) on delete restrict,
  provider text not null check (length(btrim(provider)) between 1 and 40),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- { "products": { "received": n, "created": n, "updated": n, "unchanged": n, "protected": n, "failed": n }, ... }
  counters jsonb not null default '{}'::jsonb check (jsonb_typeof(counters) = 'object'),
  -- [ { "entity": "lots", "external_id": "L-1", "message": "..." }, ... ] (hasta 200)
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  -- Falla que cortó la ejecución (ERP caído, configuración inválida...). Mensaje ya sanitizado.
  error_message text check (error_message is null or length(error_message) <= 500),
  constraint erp_sync_runs_finished_check check ((status = 'running') = (finished_at is null))
);
create index idx_erp_sync_runs_company_started on public.erp_sync_runs(company_id, started_at desc);
alter table public.erp_sync_runs enable row level security;
revoke all on public.erp_sync_runs from anon, authenticated;
grant select on public.erp_sync_runs to authenticated;
create policy erp_sync_runs_select on public.erp_sync_runs for select to authenticated
  using (company_id = (select public.auth_company_id()) and (select public.auth_role()) = 'logistics_manager');
