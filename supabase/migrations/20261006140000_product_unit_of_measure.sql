-- Unidad de medida base por producto.
--
-- Hasta ahora la unidad se guardaba en cada pallet (pallets.unit_of_measure) y en cada
-- stock informado por una distribuidora (distributor_product_stocks.unit_of_measure),
-- así que un mismo producto podía tener pallets en cajas y stock en unidades, y la
-- redistribución (US12) no podía comparar las cantidades. La unidad pasa a ser un dato
-- del producto: pallets, stock de distribuidoras y lotes informados se expresan en ella.
--
-- * "kilogramos" es el caso de peso variable y admite decimales; "unidades" y "cajas",
--   solo enteros.
-- * No hay factores de conversión entre unidades (1 caja = 12 unidades): cuando se
--   integre el ERP, la unidad del producto (uom_id) y sus conversiones vendrán de ahí.
--
-- Migración de datos: cada producto toma la unidad más usada en sus pallets; si no tiene
-- pallets con unidad, la de su stock en distribuidoras; si no, 'unidades'. Las cantidades
-- no se convierten: quedan interpretadas en la unidad elegida.

-- ------------------------------------------------------------
-- 1. products.unit_of_measure
-- ------------------------------------------------------------
alter table public.products add column unit_of_measure text;

update public.products product
set unit_of_measure = coalesce(
  (
    select pallet.unit_of_measure
    from public.pallets pallet
    join public.batches batch on batch.id = pallet.batch_id
    where batch.product_id = product.id and pallet.unit_of_measure is not null
    group by pallet.unit_of_measure
    order by count(*) desc, pallet.unit_of_measure
    limit 1
  ),
  (
    select stock.unit_of_measure
    from public.distributor_product_stocks stock
    where stock.product_id = product.id
    group by stock.unit_of_measure
    order by count(*) desc, stock.unit_of_measure
    limit 1
  ),
  'unidades'
);

alter table public.products
  alter column unit_of_measure set not null,
  add constraint products_unit_of_measure_allowed check (
    unit_of_measure in ('unidades', 'cajas', 'kilogramos')
  );

comment on column public.products.unit_of_measure is
  'Unidad base del producto: unidades, cajas o kilogramos (solo kilogramos admite decimales). Vale para sus pallets y para el stock de las distribuidoras.';

-- ------------------------------------------------------------
-- 2. Pallets y stock de distribuidoras dejan de guardar unidad
-- ------------------------------------------------------------
alter table public.pallets
  drop constraint pallets_quantity_unit_pair,
  drop constraint pallets_unit_of_measure_allowed,
  drop column unit_of_measure;

comment on column public.pallets.quantity is
  'Cantidad propia del pallet, en la unidad de su producto. NULL indica un pallet histórico sin definir.';

alter table public.distributor_product_stocks
  drop constraint distributor_product_stocks_unit_of_measure_allowed,
  drop column unit_of_measure;

comment on column public.distributor_product_stocks.current_stock is
  'Suma de los lotes informados (distributor_batch_stocks), en la unidad del producto.';
comment on column public.distributor_product_stocks.daily_consumption is
  'Consumo diario estimado, en la unidad del producto.';
comment on table public.distributor_batch_stocks is
  'Cantidad de cada lote en cada distribuidora, en la unidad del producto. Se escribe solo con save_distributor_stock.';

-- ------------------------------------------------------------
-- 3. save_distributor_stock toma la unidad del producto
-- ------------------------------------------------------------
-- Misma función que 20261006130000_distributor_batch_stocks.sql sin p_unit_of_measure:
-- la unidad del producto decide si las cantidades pueden tener decimales.
drop function public.save_distributor_stock(uuid, text, numeric, jsonb);

create function public.save_distributor_stock(
  p_product_id uuid,
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
  product_unit text;
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

  select p.unit_of_measure into product_unit from public.products p
    where p.id = p_product_id and p.company_id = caller_company;
  if product_unit is null then
    raise exception 'Producto no disponible' using errcode = 'P3903';
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
    if product_unit <> 'kilogramos' and entry_quantity <> trunc(entry_quantity) then
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
    (company_id, distributor_id, product_id, current_stock, daily_consumption)
  values (caller_company, caller_distributor, p_product_id,
    coalesce((select sum(q) from unnest(quantities) q), 0), p_daily_consumption)
  on conflict (distributor_id, product_id) do update
    set current_stock = excluded.current_stock,
        daily_consumption = excluded.daily_consumption,
        updated_at = now();

  delete from public.distributor_batch_stocks
    where distributor_id = caller_distributor and product_id = p_product_id;

  insert into public.distributor_batch_stocks (company_id, distributor_id, product_id, batch_id, quantity)
  select caller_company, caller_distributor, p_product_id, input.batch_id, input.quantity
  from unnest(batch_ids, quantities) as input(batch_id, quantity);
end;
$$;
revoke all on function public.save_distributor_stock(uuid, numeric, jsonb) from public, anon, service_role;
grant execute on function public.save_distributor_stock(uuid, numeric, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4. get_lot_traceability devuelve la unidad del producto
-- ------------------------------------------------------------
-- Misma función que 20260918120000_get_lot_traceability.sql; pallet_unit_of_measure pasa
-- a product_unit_of_measure. Cambia el tipo de retorno, por eso se borra y se recrea.
drop function public.get_lot_traceability(text);

create function public.get_lot_traceability(p_batch_number text)
returns table (
  batch_id uuid,
  batch_number text,
  expiration_date date,
  batch_quantity integer,
  product_id uuid,
  product_name text,
  product_sku text,
  product_unit_of_measure text,
  pallet_id uuid,
  pallet_qr_code text,
  pallet_status pallet_status,
  pallet_current_location text,
  pallet_quantity numeric,
  movement_id uuid,
  movement_order_id uuid,
  movement_origin_location text,
  movement_destination_location text,
  movement_resulting_status pallet_status,
  movement_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth_role() is distinct from 'logistics_manager' then
    return;
  end if;

  if p_batch_number is null
     or btrim(p_batch_number) = ''
     or length(btrim(p_batch_number)) > 512 then
    return;
  end if;

  return query
  select
    batch.id,
    batch.batch_number,
    batch.expiration_date,
    batch.quantity,
    product.id,
    product.name,
    product.sku,
    product.unit_of_measure,
    pallet.id,
    pallet.qr_code,
    pallet.status,
    pallet.current_location,
    pallet.quantity,
    movement.id,
    movement.order_id,
    movement.origin_location,
    movement.destination_location,
    movement.resulting_status,
    movement.created_at
  from batches batch
  join products product on product.id = batch.product_id
  left join pallets pallet on pallet.batch_id = batch.id
  left join movements movement on movement.pallet_id = pallet.id
  where batch.batch_number = btrim(p_batch_number)
    and product.company_id = auth_company_id()
  order by pallet.qr_code, movement.created_at, movement.id;
end;
$$;

revoke all on function public.get_lot_traceability(text) from public, anon;
grant execute on function public.get_lot_traceability(text) to authenticated;
