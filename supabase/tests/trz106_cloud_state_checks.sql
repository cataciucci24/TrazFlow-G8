-- Verificación remota de solo lectura: usa usuarios y pallets existentes.
-- No crea fixtures ni registra movimientos. Todo el contexto se revierte.
begin read only;
do $$
declare
  actor record;
  sample_qr text;
  foreign_qr text;
  expected_count integer;
  actual_count integer;
  checked integer := 0;
begin
  if has_function_privilege('anon', 'public.get_pallet_scan_details(text)', 'execute') then
    raise exception 'TRZ-106: la función permite acceso anónimo';
  end if;
  for actor in
    select distinct on (u.role) u.id, u.role, u.company_id
    from public.users u where u.revoked_at is null
      and exists (select 1 from public.pallets p where p.company_id=u.company_id)
    order by u.role, u.id
  loop
    -- Datos esperados calculados antes de adoptar los permisos del usuario.
    select p.qr_code into sample_qr from public.pallets p
      where p.company_id=actor.company_id
        and (actor.role::text <> 'driver_operator' or exists (
          select 1 from public.order_pallets op join public.dispatch_orders o on o.id=op.order_id
          where op.pallet_id=p.id and o.driver_id=actor.id and o.company_id=actor.company_id
        )) limit 1;
    select p.qr_code into foreign_qr from public.pallets p
      where p.company_id<>actor.company_id limit 1;
    perform set_config('request.jwt.claim.sub', actor.id::text, true);
    set local role authenticated;
    if sample_qr is not null then
      select count(*) into actual_count from public.get_pallet_scan_details(sample_qr) d
        where d.qr_code=sample_qr and d.product_name is not null and d.batch_number is not null
          and not (to_jsonb(d) ?| array['email','user_id','details']);
      if actual_count <> 1 then raise exception 'TRZ-106: falló la ficha para rol %', actor.role; end if;
    end if;
    select count(*) into expected_count from public.get_pallet_scan_details('TRZ106-NO-EXISTE');
    if expected_count <> 0 then raise exception 'TRZ-106: código inexistente devuelve datos'; end if;
    if foreign_qr is not null and exists (select 1 from public.get_pallet_scan_details(foreign_qr)) then
      raise exception 'TRZ-106: acceso entre empresas para rol %', actor.role;
    end if;
    reset role;
    checked := checked + 1;
    raise notice 'TRZ-106: rol % verificado; pallet accesible: %', actor.role, sample_qr is not null;
  end loop;
  if checked=0 then raise exception 'TRZ-106: no hay usuarios operativos para verificar'; end if;
end $$;
rollback;
