-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada.
-- Todos los fixtures se revierten al finalizar.
begin;

do $$
declare
  company uuid;
  product uuid;
  batch uuid;
  first_pallet uuid;
  first_qr text;
  second_qr text;
begin
  insert into public.companies (name) values ('US-B1 test') returning id into company;
  insert into public.products (company_id, sku, name, unit_of_measure)
    values (company, 'US-B1', 'Test', 'unidades') returning id into product;
  insert into public.batches (product_id, batch_number, quantity)
    values (product, 'US-B1', 0) returning id into batch;

  insert into public.pallets (company_id, batch_id)
    values (company, batch) returning id, qr_code into first_pallet, first_qr;
  insert into public.pallets (company_id, batch_id)
    values (company, batch) returning qr_code into second_qr;

  if first_qr is null or first_qr !~ '^PAL-[0-9a-f-]{36}$'
     or second_qr is null or first_qr = second_qr then
    raise exception 'US-B1: los QR deben generarse automáticamente y ser distintos';
  end if;

  begin
    update public.pallets set qr_code = 'MANUAL' where id = first_pallet;
    raise exception 'US-B1: se permitió modificar el QR';
  exception when check_violation then
    null;
  end;

  begin
    update public.pallets set qr_code = null where id = first_pallet;
    raise exception 'US-B1: se permitió borrar el QR';
  exception when check_violation then
    null;
  end;

  -- Los cambios del flujo logístico deben seguir funcionando.
  update public.pallets set status = 'assigned' where id = first_pallet;
  update public.pallets set status = 'in_transit' where id = first_pallet;
  update public.pallets set status = 'received', current_location = 'Destino'
    where id = first_pallet;
  if (select qr_code from public.pallets where id = first_pallet) <> first_qr then
    raise exception 'US-B1: el flujo cambió el QR';
  end if;

  begin
    insert into public.pallets (company_id, batch_id, qr_code)
      values (company, batch, first_qr);
    raise exception 'US-B1: se permitió un QR duplicado';
  exception when unique_violation then
    null;
  end;
end;
$$;

rollback;
