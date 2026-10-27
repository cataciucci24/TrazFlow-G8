-- TRZ-100 (segunda parte): editar la cantidad de un pallet asociado a una orden que todavía no se despachó.
--
-- Caso: el despacho no se confirma si lo armado no coincide con lo pedido (20261028100400). Depósito suele
-- descubrir la diferencia recién al terminar de escanear, y para completar la orden el comprador puede preferir
-- sumar mercadería al pallet que ya está en vez de armar otro. Hasta acá solo se editaban pallets en depósito.
--
-- Regla:
--   * Solo logística, solo la cantidad (producto y lote no cambian) y solo pallets `assigned` a una orden en
--     borrador (relación expected = true). Los heredados de saldos del ERP siguen sin editarse.
--   * Si depósito ya lo había validado, la validación se borra en la misma transacción: tiene que volver a
--     escanearlo, para que nadie confirme una cantidad que no se revisó físicamente.
--   * El tope por saldo del ERP se sigue aplicando (trg_pallets_erp_stock_cap corre en el update de quantity y
--     falla con TF100/TF101/TF102, que la app ya traduce).
--   * Se bloquea la orden (`for update`) como confirm_dispatch_order: una edición y una confirmación simultáneas
--     se serializan, y la confirmación ve la validación borrada.
--
-- Devuelve una fila con outcome (sin excepción, como confirm_dispatch_order), salvo los errores del tope.

create function public.update_assigned_pallet_quantity(p_pallet_id uuid, p_quantity numeric)
returns table (
  outcome text,
  pallet_id uuid,
  qr_code text,
  order_id uuid,
  validation_cleared boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pallet public.pallets%rowtype;
  v_unit text;
  v_order_id uuid;
  v_validated_at timestamptz;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'logistics_manager' then
    return query select 'forbidden', null::uuid, null::text, null::uuid, false;
    return;
  end if;

  -- Primero la orden (mismo orden de locks que confirm_dispatch_order: orden y después pallets).
  select relation.order_id into v_order_id
  from public.order_pallets relation
  join public.dispatch_orders orders on orders.id = relation.order_id
  where relation.pallet_id = p_pallet_id
    and relation.expected = true
    and orders.company_id = public.auth_company_id()
    and orders.status = 'draft';

  if v_order_id is not null then
    perform 1 from public.dispatch_orders orders where orders.id = v_order_id for update;
  end if;

  select * into v_pallet
  from public.pallets pallet
  where pallet.id = p_pallet_id
    and pallet.company_id = public.auth_company_id()
  for update;

  if not found then
    return query select 'pallet_not_found', null::uuid, null::text, null::uuid, false;
    return;
  end if;

  -- Revalidado con los locks tomados: la orden sigue en borrador y el pallet sigue asignado a ella.
  if v_order_id is null or v_pallet.status <> 'assigned' or not exists (
    select 1
    from public.order_pallets relation
    join public.dispatch_orders orders on orders.id = relation.order_id
    where relation.order_id = v_order_id and relation.pallet_id = p_pallet_id
      and relation.expected = true and orders.status = 'draft'
  ) then
    return query select 'not_assigned', v_pallet.id, v_pallet.qr_code, null::uuid, false;
    return;
  end if;

  if v_pallet.source_system is distinct from 'trazflow' then
    return query select 'not_editable', v_pallet.id, v_pallet.qr_code, v_order_id, false;
    return;
  end if;

  select product.unit_of_measure into v_unit
  from public.batches batch
  join public.products product on product.id = batch.product_id
  where batch.id = v_pallet.batch_id;

  if public.erp_sync_quantity_problem(p_quantity, v_unit, false) is not null then
    return query select 'invalid_quantity', v_pallet.id, v_pallet.qr_code, v_order_id, false;
    return;
  end if;

  -- Guardar sin cambiar la cantidad no borra la validación.
  if v_pallet.quantity = p_quantity then
    return query select 'unchanged', v_pallet.id, v_pallet.qr_code, v_order_id, false;
    return;
  end if;

  update public.pallets set quantity = p_quantity where id = v_pallet.id;

  select relation.validated_at into v_validated_at
  from public.order_pallets relation
  where relation.order_id = v_order_id and relation.pallet_id = v_pallet.id;

  if v_validated_at is not null then
    update public.order_pallets
    set validated_at = null,
        validated_by = null,
        detected_at_dispatch = false
    where order_pallets.order_id = v_order_id and order_pallets.pallet_id = v_pallet.id;
  end if;

  return query select 'updated', v_pallet.id, v_pallet.qr_code, v_order_id, v_validated_at is not null;
end;
$$;

revoke all on function public.update_assigned_pallet_quantity(uuid, numeric) from public, anon;
grant execute on function public.update_assigned_pallet_quantity(uuid, numeric) to authenticated;
