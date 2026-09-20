-- ============================================================================
-- TRZ-13 (US13): trazabilidad de lote
-- ============================================================================
-- Trae lote + todos sus pallets + todos los movimientos de esos pallets en una
-- sola llamada, para no hacer N+1 queries desde el cliente (lote -> pallets ->
-- movements de cada pallet). SECURITY DEFINER porque, igual que el resto de
-- las funciones de este archivo de migraciones, hace las validaciones de
-- identidad/rol/empresa a mano en vez de depender de las policies de RLS
-- (el dueño de la función no queda sujeto a ellas).

create or replace function get_lot_traceability(p_batch_number text)
returns table (
  batch_id uuid,
  batch_number text,
  expiration_date date,
  batch_quantity integer,
  product_id uuid,
  product_name text,
  product_sku text,
  pallet_id uuid,
  pallet_qr_code text,
  pallet_status pallet_status,
  pallet_current_location text,
  pallet_quantity numeric,
  pallet_unit_of_measure text,
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
    pallet.id,
    pallet.qr_code,
    pallet.status,
    pallet.current_location,
    pallet.quantity,
    pallet.unit_of_measure,
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

revoke all on function get_lot_traceability(text) from public;
grant execute on function get_lot_traceability(text) to authenticated;
