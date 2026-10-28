-- Solo lectura sobre datos existentes. No crea ni modifica registros.
begin read only;
do $$
declare actor record; expected_orders bigint; visible_orders bigint; expected_lines bigint; visible_lines bigint; checked integer := 0;
begin
  for actor in select id, company_id from public.users where role::text='logistics_manager' and revoked_at is null loop
    select count(*) into expected_orders from public.dispatch_orders o
      where o.company_id=actor.company_id and o.status::text in ('confirmed','delivered','delivered_with_discrepancy')
        and o.confirmed_at is not null and o.confirmed_at <= now();
    select count(*) into expected_lines from public.order_pallets op
      join public.dispatch_orders o on o.id=op.order_id join public.pallets p on p.id=op.pallet_id
      join public.batches b on b.id=p.batch_id join public.products product on product.id=b.product_id
      where op.expected and o.company_id=actor.company_id and p.company_id=actor.company_id and product.company_id=actor.company_id
        and o.status::text in ('confirmed','delivered','delivered_with_discrepancy') and o.confirmed_at is not null and o.confirmed_at <= now();
    perform set_config('request.jwt.claim.sub', actor.id::text, true);
    set local role authenticated;
    select count(*) into visible_orders from public.dispatch_orders o
      where o.company_id=actor.company_id and o.status::text in ('confirmed','delivered','delivered_with_discrepancy')
        and o.confirmed_at is not null and o.confirmed_at <= now();
    select count(*) into visible_lines from public.order_pallets op
      join public.dispatch_orders o on o.id=op.order_id join public.pallets p on p.id=op.pallet_id
      join public.batches b on b.id=p.batch_id join public.products product on product.id=b.product_id
      where op.expected and o.company_id=actor.company_id and p.company_id=actor.company_id and product.company_id=actor.company_id
        and o.status::text in ('confirmed','delivered','delivered_with_discrepancy') and o.confirmed_at is not null and o.confirmed_at <= now();
    if visible_orders<>expected_orders or visible_lines<>expected_lines then
      raise exception 'TRZ-109: los permisos impiden consultar parte del historial de logística';
    end if;
    if exists (select 1 from public.dispatch_orders where company_id<>actor.company_id) then
      raise exception 'TRZ-109: logística puede leer órdenes de otra empresa';
    end if;
    reset role;
    checked := checked+1;
  end loop;
  if checked=0 then raise exception 'TRZ-109: no se pudo verificar ningún usuario de logística'; end if;
end $$;
select 'ok' as resultado, 'historial y productos accesibles con RLS; empresas aisladas' as verificacion;
rollback;
