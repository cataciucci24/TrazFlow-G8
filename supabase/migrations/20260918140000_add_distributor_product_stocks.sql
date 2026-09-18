-- US8: cobertura de stock por distribuidora y producto.
create table distributor_product_stocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  distributor_id uuid not null references distributors(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  current_stock integer not null check (current_stock >= 0),
  daily_consumption numeric(12, 2) not null check (daily_consumption > 0),
  updated_at timestamptz not null default now(),
  unique (distributor_id, product_id)
);

create index idx_distributor_product_stocks_company on distributor_product_stocks(company_id);

alter table distributor_product_stocks enable row level security;

create policy distributor_product_stocks_logistics on distributor_product_stocks
  for all using (
    auth_role() = 'logistics_manager'
    and company_id = auth_company_id()
  )
  with check (
    auth_role() = 'logistics_manager'
    and company_id = auth_company_id()
  );

create trigger trg_distributor_product_stocks_updated_at
before update on distributor_product_stocks
for each row execute function set_updated_at();
