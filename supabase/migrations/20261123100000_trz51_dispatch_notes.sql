-- TRZ-51: remito digital de cada despacho.
--
-- Se genera solo cuando la orden pasa a despachada (confirmed_at deja de ser null: confirm_dispatch_order), sin
-- pasos extra, y queda congelado: guarda una copia de los datos de ese momento (emisor, destinatario, orden y
-- pallets con producto, lote y cantidad). Si después cambia un producto o un pallet, el remito no cambia.
-- Número correlativo por empresa. Sin CAI ni CAE: no tiene validez fiscal.
--
-- Lectura: logística y depósito de la empresa. Nadie escribe por la API; el trigger escribe con security definer.
-- Las órdenes que ya estaban despachadas reciben su remito al aplicar la migración (content.backfilled = true).

create table public.dispatch_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null unique references public.dispatch_orders(id) on delete cascade,
  number integer not null check (number > 0),
  issued_at timestamptz not null,
  issued_by uuid references public.users(id) on delete set null,
  -- Copia congelada del remito. Ver public.dispatch_note_content.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  constraint dispatch_notes_company_number_key unique (company_id, number)
);

alter table public.dispatch_notes enable row level security;
revoke all on public.dispatch_notes from anon, authenticated;
grant select on public.dispatch_notes to authenticated;
grant select on public.dispatch_notes to service_role;

create policy dispatch_notes_select on public.dispatch_notes
  for select to authenticated
  using (
    company_id = (select public.auth_company_id())
    and (select public.auth_role()) in ('logistics_manager', 'warehouse_operator')
  );

-- Un remito emitido no se modifica (sí se borra junto con su orden o empresa).
create function public.guard_dispatch_note_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Un remito emitido no se modifica.' using errcode = '42501';
end;
$$;
revoke all on function public.guard_dispatch_note_immutable() from public, anon, authenticated;
create trigger trg_dispatch_notes_immutable before update on public.dispatch_notes
  for each row execute function public.guard_dispatch_note_immutable();

-- Contenido del remito de una orden, con los datos de este momento.
create function public.dispatch_note_content(p_order_id uuid, p_issued_by uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'issuer', jsonb_build_object('name', company.name, 'taxId', company.tax_id),
    'recipient', jsonb_build_object('name', recipient.name, 'address', recipient.address),
    'order', jsonb_build_object('id', orders.id, 'externalId', orders.external_id, 'createdAt', orders.created_at),
    'issuedBy', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = p_issued_by),
    'driver', (select jsonb_build_object('id', d.id, 'name', d.name) from public.users d where d.id = orders.driver_id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'palletCode', pallet.qr_code,
          'productName', product.name,
          'productSku', product.sku,
          'lotNumber', batch.batch_number,
          'expirationDate', batch.expiration_date,
          'quantity', item.quantity,
          'unit', product.unit_of_measure
        ) order by product.name, batch.batch_number, pallet.qr_code)
      from public.order_pallets relation
      join public.pallets pallet on pallet.id = relation.pallet_id
      -- La orden conserva el contenido del despacho aunque el pallet reingrese.
      cross join lateral jsonb_to_recordset(relation.expected_items)
        item("productId" uuid, "batchId" uuid, quantity numeric)
      join public.batches batch on batch.id = item."batchId"
      join public.products product on product.id = item."productId"
        and product.id = batch.product_id and product.company_id = orders.company_id
      where relation.order_id = orders.id and relation.expected = true
    ), '[]'::jsonb)
  )
  from public.dispatch_orders orders
  join public.companies company on company.id = orders.company_id
  join public.distributors recipient on recipient.id = orders.distributor_id
  where orders.id = p_order_id;
$$;
revoke all on function public.dispatch_note_content(uuid, uuid) from public, anon, authenticated;

-- Emite el remito de una orden (si todavía no tiene). El número es el siguiente de la empresa; el lock evita
-- que dos despachos simultáneos de la misma empresa tomen el mismo número.
create function public.issue_dispatch_note(p_order_id uuid, p_issued_at timestamptz, p_issued_by uuid, p_backfilled boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_content jsonb;
begin
  select company_id into v_company from public.dispatch_orders where id = p_order_id;
  if v_company is null or exists (select 1 from public.dispatch_notes where order_id = p_order_id) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('dispatch_notes:' || v_company::text));
  v_content := public.dispatch_note_content(p_order_id, p_issued_by);
  if p_backfilled then
    v_content := v_content || jsonb_build_object('backfilled', true);
  end if;
  insert into public.dispatch_notes (company_id, order_id, number, issued_at, issued_by, content)
  values (
    v_company,
    p_order_id,
    coalesce((select max(number) from public.dispatch_notes where company_id = v_company), 0) + 1,
    p_issued_at,
    p_issued_by,
    v_content
  )
  on conflict (order_id) do nothing;
end;
$$;
revoke all on function public.issue_dispatch_note(uuid, timestamptz, uuid, boolean) from public, anon, authenticated;

create function public.enqueue_dispatch_note()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.issue_dispatch_note(new.id, new.confirmed_at, auth.uid());
  return null;
end;
$$;
revoke all on function public.enqueue_dispatch_note() from public, anon, authenticated;

create trigger trg_dispatch_orders_dispatch_note after update of confirmed_at on public.dispatch_orders
  for each row
  when (old.confirmed_at is null and new.confirmed_at is not null)
  execute function public.enqueue_dispatch_note();

-- Órdenes ya despachadas: su remito, numerado por orden de despacho.
do $$
declare
  v_order record;
begin
  for v_order in
    select orders.id, orders.confirmed_at
    from public.dispatch_orders orders
    where orders.confirmed_at is not null
    order by orders.company_id, orders.confirmed_at, orders.id
  loop
    perform public.issue_dispatch_note(v_order.id, v_order.confirmed_at, null, true);
  end loop;
end;
$$;
