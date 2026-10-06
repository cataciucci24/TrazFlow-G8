-- TRZ-90 (extiende US11): stock de distribuidoras por lote y niveles de vencimiento por empresa.
--
-- * distributor_batch_stocks guarda cuánto tiene cada distribuidora de cada lote.
--   distributor_product_stocks sigue siendo la fila por producto (unidad y consumo
--   diario) y su current_stock pasa a ser la suma de los lotes. Así las alertas de
--   stock (US9) y la redistribución (US12) no cambian.
-- * El stock solo se escribe con save_distributor_stock, que reemplaza los lotes del
--   producto y recalcula el total en una sola transacción. Las escrituras directas
--   quedan cerradas para que el total no se desincronice de los lotes.
-- * Los días de cada nivel de alerta de vencimiento (crítico, precaución, próximo)
--   pasan a configurarse por empresa y valen para depósito y distribuidoras.
--
-- Las filas de stock informadas antes de esta migración no tienen lotes: siguen
-- contando para la cobertura y se completan cuando el operador vuelve a guardarlas.

-- ------------------------------------------------------------
-- 1. Niveles de alerta de vencimiento por empresa
-- ------------------------------------------------------------
alter table public.companies
  add column expiration_critical_days integer not null default 30,
  add column expiration_caution_days integer not null default 60,
  add column expiration_upcoming_days integer not null default 90,
  add constraint companies_expiration_thresholds_order check (
    expiration_critical_days >= 1
    and expiration_critical_days < expiration_caution_days
    and expiration_caution_days < expiration_upcoming_days
    and expiration_upcoming_days <= 365
  );

comment on column public.companies.expiration_critical_days is
  'Un lote que vence en esta cantidad de días o menos genera una alerta crítica.';
comment on column public.companies.expiration_caution_days is
  'Hasta esta cantidad de días la alerta de vencimiento es de precaución.';
comment on column public.companies.expiration_upcoming_days is
  'Hasta esta cantidad de días la alerta de vencimiento es de próximo; más allá no se alerta.';

-- companies no tiene policies de lectura: los niveles se leen con esta función.
create function public.get_expiration_thresholds()
returns table (critical_days integer, caution_days integer, upcoming_days integer)
language sql stable security definer
set search_path = ''
as $$
  select c.expiration_critical_days, c.expiration_caution_days, c.expiration_upcoming_days
  from public.companies c
  where c.id = public.auth_company_id();
$$;
revoke all on function public.get_expiration_thresholds() from public, anon, service_role;
grant execute on function public.get_expiration_thresholds() to authenticated;

create function public.set_expiration_thresholds(p_critical_days integer, p_caution_days integer, p_upcoming_days integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
begin
  if manager_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  if p_critical_days is null or p_caution_days is null or p_upcoming_days is null
    or p_critical_days < 1 or p_critical_days >= p_caution_days
    or p_caution_days >= p_upcoming_days or p_upcoming_days > 365 then
    raise exception 'Niveles de vencimiento inválidos' using errcode = 'P3901';
  end if;
  update public.companies
  set expiration_critical_days = p_critical_days,
      expiration_caution_days = p_caution_days,
      expiration_upcoming_days = p_upcoming_days
  where id = manager_company;
end;
$$;
revoke all on function public.set_expiration_thresholds(integer, integer, integer) from public, anon, service_role;
grant execute on function public.set_expiration_thresholds(integer, integer, integer) to authenticated;

-- ------------------------------------------------------------
-- 2. Stock de distribuidoras por lote
-- ------------------------------------------------------------
create table public.distributor_batch_stocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  distributor_id uuid not null,
  product_id uuid not null,
  batch_id uuid not null references public.batches(id) on delete cascade,
  quantity numeric(12, 2) not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  unique (distributor_id, batch_id),
  -- Cada lote cuelga de la fila del producto: hereda su unidad y se borra con ella.
  foreign key (distributor_id, product_id)
    references public.distributor_product_stocks(distributor_id, product_id) on delete cascade
);

comment on table public.distributor_batch_stocks is
  'Cantidad de cada lote en cada distribuidora, en la unidad de distributor_product_stocks. Se escribe solo con save_distributor_stock.';

create index idx_distributor_batch_stocks_company on public.distributor_batch_stocks(company_id);
create index idx_distributor_batch_stocks_product on public.distributor_batch_stocks(distributor_id, product_id);
create index idx_distributor_batch_stocks_batch on public.distributor_batch_stocks(batch_id);

alter table public.distributor_batch_stocks enable row level security;

create policy distributor_batch_stocks_logistics on public.distributor_batch_stocks
  for select to authenticated
  using (auth_role() = 'logistics_manager' and company_id = auth_company_id());

create policy distributor_batch_stocks_operator on public.distributor_batch_stocks
  for select to authenticated
  using (
    auth_role() = 'distributor_operator'
    and company_id = auth_company_id()
    and operates_for_distributor(distributor_id)
  );

-- distributor_product_stocks pasa a ser de solo lectura para la app.
drop policy distributor_product_stocks_logistics on public.distributor_product_stocks;
drop policy distributor_product_stocks_operator on public.distributor_product_stocks;

create policy distributor_product_stocks_logistics on public.distributor_product_stocks
  for select to authenticated
  using (auth_role() = 'logistics_manager' and company_id = auth_company_id());

create policy distributor_product_stocks_operator on public.distributor_product_stocks
  for select to authenticated
  using (
    auth_role() = 'distributor_operator'
    and company_id = auth_company_id()
    and operates_for_distributor(distributor_id)
  );

-- p_batches: [{"batch_id": "...", "quantity": 12.5}, ...]. Una lista vacía deja el
-- producto con stock cero. Reemplaza todos los lotes informados antes para ese producto.
create function public.save_distributor_stock(
  p_product_id uuid,
  p_unit_of_measure text,
  p_daily_consumption numeric,
  p_batches jsonb
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  caller_company uuid;
  caller_distributor uuid;
  distributor_count integer;
  entry jsonb;
  entry_batch uuid;
  entry_quantity numeric;
  batch_ids uuid[] := '{}';
  quantities numeric[] := '{}';
begin
  select u.company_id into caller_company from public.users u
    where u.id = auth.uid() and u.role = 'distributor_operator' and u.revoked_at is null;
  if caller_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;

  select count(*), min(du.distributor_id::text)::uuid into distributor_count, caller_distributor
    from public.distributor_users du
    join public.distributors d on d.id = du.distributor_id
    where du.user_id = auth.uid() and d.company_id = caller_company;
  if distributor_count <> 1 then
    raise exception 'La cuenta no tiene una única distribuidora' using errcode = 'P3902';
  end if;

  if not exists (select 1 from public.products p where p.id = p_product_id and p.company_id = caller_company) then
    raise exception 'Producto no disponible' using errcode = 'P3903';
  end if;
  if p_unit_of_measure is null or p_unit_of_measure not in ('unidades', 'cajas', 'kilogramos') then
    raise exception 'Unidad de medida inválida' using errcode = 'P3904';
  end if;
  if p_daily_consumption is null or p_daily_consumption <= 0 then
    raise exception 'El consumo diario debe ser mayor a cero' using errcode = 'P3905';
  end if;
  if p_batches is null or jsonb_typeof(p_batches) <> 'array' then
    raise exception 'Lotes inválidos' using errcode = 'P3906';
  end if;

  for entry in select value from jsonb_array_elements(p_batches) loop
    begin
      entry_batch := (entry ->> 'batch_id')::uuid;
      entry_quantity := (entry ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Lotes inválidos' using errcode = 'P3906';
    end;
    if entry_batch is null or entry_quantity is null or entry_quantity <= 0
      or entry_quantity <> round(entry_quantity, 2) then
      raise exception 'La cantidad de cada lote debe ser mayor a cero' using errcode = 'P3906';
    end if;
    if p_unit_of_measure <> 'kilogramos' and entry_quantity <> trunc(entry_quantity) then
      raise exception 'En unidades o cajas la cantidad debe ser entera' using errcode = 'P3906';
    end if;
    if not exists (select 1 from public.batches b where b.id = entry_batch and b.product_id = p_product_id) then
      raise exception 'El lote no corresponde al producto' using errcode = 'P3907';
    end if;
    if entry_batch = any(batch_ids) then
      raise exception 'Hay un lote repetido' using errcode = 'P3908';
    end if;
    batch_ids := batch_ids || entry_batch;
    quantities := quantities || entry_quantity;
  end loop;

  insert into public.distributor_product_stocks
    (company_id, distributor_id, product_id, current_stock, daily_consumption, unit_of_measure)
  values (caller_company, caller_distributor, p_product_id,
    coalesce((select sum(q) from unnest(quantities) q), 0), p_daily_consumption, p_unit_of_measure)
  on conflict (distributor_id, product_id) do update
    set current_stock = excluded.current_stock,
        daily_consumption = excluded.daily_consumption,
        unit_of_measure = excluded.unit_of_measure,
        updated_at = now();

  delete from public.distributor_batch_stocks
    where distributor_id = caller_distributor and product_id = p_product_id;

  insert into public.distributor_batch_stocks (company_id, distributor_id, product_id, batch_id, quantity)
  select caller_company, caller_distributor, p_product_id, input.batch_id, input.quantity
  from unnest(batch_ids, quantities) as input(batch_id, quantity);
end;
$$;
revoke all on function public.save_distributor_stock(uuid, text, numeric, jsonb) from public, anon, service_role;
grant execute on function public.save_distributor_stock(uuid, text, numeric, jsonb) to authenticated;
