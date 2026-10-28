-- Catálogo de la propuesta comercial. Importes en centavos de USD.
-- NULL en los límites significa ilimitado; NULL en precios significa a medida.
create table public.subscription_plans (
  code text primary key,
  name text not null,
  monthly_price_cents integer check (monthly_price_cents >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  max_operators integer check (max_operators > 0),
  max_pallets_per_month integer check (max_pallets_per_month > 0),
  printer_count integer check (printer_count > 0),
  printer_model text not null,
  equipment_price_cents integer check (equipment_price_cents >= 0),
  preliminary boolean not null default true,
  display_order integer not null unique
);

create table public.company_plans (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code) on delete restrict,
  assigned_at timestamptz not null default now()
);

create index company_plans_plan_code_idx on public.company_plans(plan_code);

alter table public.subscription_plans enable row level security;
alter table public.company_plans enable row level security;

revoke all on public.subscription_plans, public.company_plans from anon, authenticated;
grant select on public.subscription_plans, public.company_plans to authenticated;
grant all on public.subscription_plans, public.company_plans to service_role;

create policy subscription_plans_read on public.subscription_plans for select to authenticated
  using (
    (select public.auth_role()) = 'logistics_manager'
    and exists (select 1 from public.users where id = (select auth.uid()) and revoked_at is null)
  );

create policy company_plans_read on public.company_plans for select to authenticated
  using (
    company_id = (select public.auth_company_id())
    and (select public.auth_role()) = 'logistics_manager'
    and exists (select 1 from public.users where id = (select auth.uid()) and revoked_at is null)
  );

insert into public.subscription_plans
  (code, name, monthly_price_cents, max_operators, max_pallets_per_month,
   printer_count, printer_model, equipment_price_cents, display_order)
values
  ('starter', 'Starter', 6900, 3, 500, 1, 'Zebra ZQ320', 45000, 1),
  ('growth', 'Growth', 26900, 10, 3000, 3, 'Zebra ZQ320', 135000, 2),
  ('enterprise', 'Enterprise', null, null, null, null, 'Zebra ZQ320', null, 3);

comment on table public.company_plans is
  'Plan asignado a una empresa. Sin fila significa sin plan asignado; no activa cobros ni aplica cuotas.';
comment on table public.subscription_plans is
  'Precios y límites de la propuesta comercial preliminar. Solo lectura para logística.';
