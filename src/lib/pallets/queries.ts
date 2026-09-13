import { createClient } from "@/lib/supabase/server";
import type { Pallet } from "@/lib/types";

/**
 * Fila cruda que devuelve Postgrest al embeber batches/products. El cliente
 * de Supabase no tiene tipos generados (createClient no recibe un genérico
 * Database), así que esta forma es la que observamos en runtime: la relación
 * hacia el lado "uno" de un FK puede llegar como objeto o como array según
 * la versión del cliente, por eso el mapeo defensivo en `mapPalletRow`.
 */
type RawPalletRow = {
  id: string;
  qr_code: string;
  status: Pallet["status"];
  current_location: string | null;
  batches:
    | { batch_number: string; products: { name: string; sku: string } | { name: string; sku: string }[] | null }
    | { batch_number: string; products: { name: string; sku: string } | { name: string; sku: string }[] | null }[]
    | null;
};

function mapPalletRow(row: RawPalletRow): Pallet {
  const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches;
  const product = batch
    ? Array.isArray(batch.products)
      ? batch.products[0]
      : batch.products
    : null;

  return {
    id: row.id,
    qrCode: row.qr_code,
    status: row.status,
    currentLocation: row.current_location,
    productName: product?.name ?? "—",
    productSku: product?.sku ?? "—",
    batchNumber: batch?.batch_number ?? "—",
  };
}

const PALLET_SELECT =
  "id, qr_code, status, current_location, batches ( batch_number, products ( name, sku ) )";

/** Pallets de la empresa disponibles para asociar a una orden (en depósito, sin asignar). */
export async function getAvailablePallets(companyId: string): Promise<Pallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pallets")
    .select(PALLET_SELECT)
    .eq("company_id", companyId)
    .eq("status", "in_warehouse")
    .order("qr_code");

  if (error) {
    throw new Error(
      `No se pudieron leer los pallets disponibles (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return (data ?? []).map(mapPalletRow);
}

/** Inventario completo para que logística pueda seguir cada pallet por estado. */
export async function getCompanyPallets(companyId: string): Promise<Pallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pallets")
    .select(PALLET_SELECT)
    .eq("company_id", companyId)
    .order("qr_code");

  if (error) {
    throw new Error(`No se pudieron leer los pallets (${error.code}: ${error.message}).`, { cause: error });
  }

  return (data ?? []).map(mapPalletRow);
}

/** Pallets ya asociados a una orden de despacho. */
export async function getPalletsForOrder(orderId: string): Promise<Pallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_pallets")
    .select(`pallets ( ${PALLET_SELECT} )`)
    .eq("order_id", orderId);

  if (error) {
    throw new Error(
      `No se pudieron leer los pallets de la orden (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return (data ?? [])
    .map((row) => {
      const pallet = row.pallets as unknown as RawPalletRow | RawPalletRow[] | null;
      return Array.isArray(pallet) ? pallet[0] : pallet;
    })
    .filter((pallet): pallet is RawPalletRow => pallet != null)
    .map(mapPalletRow);
}
