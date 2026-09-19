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
  created_at: string;
  batches:
    | { batch_number: string; quantity: number; products: { name: string; sku: string } | { name: string; sku: string }[] | null }
    | { batch_number: string; quantity: number; products: { name: string; sku: string } | { name: string; sku: string }[] | null }[]
    | null;
};

export type StalePallet = Pallet & {
  createdAt: string;
  lastMovementAt: string | null;
  daysWithoutMovement: number;
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
    quantity: batch?.quantity ?? 0,
  };
}

const PALLET_SELECT =
  "id, qr_code, status, current_location, created_at, batches ( batch_number, quantity, products ( name, sku ) )";

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

/** Mercadería cuya última actividad supera el umbral indicado, ordenada por antigüedad. */
export async function getStalePallets(
  companyId: string,
  thresholdDays: number,
): Promise<StalePallet[]> {
  const supabase = await createClient();
  const { data: palletData, error: palletError } = await supabase
    .from("pallets")
    .select(PALLET_SELECT)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  if (palletError) {
    throw new Error(`No se pudieron leer los pallets inmovilizados (${palletError.code}: ${palletError.message}).`, { cause: palletError });
  }

  const pallets = (palletData ?? []) as unknown as RawPalletRow[];
  if (pallets.length === 0) return [];

  const palletIds = pallets.map((pallet) => pallet.id);
  const { data: movementData, error: movementError } = await supabase
    .from("movements")
    .select("pallet_id, created_at")
    .in("pallet_id", palletIds)
    .order("created_at", { ascending: false });

  if (movementError) {
    throw new Error(`No se pudo consultar la actividad de los pallets (${movementError.code}: ${movementError.message}).`, { cause: movementError });
  }

  const latestMovementByPallet = new Map<string, string>();
  for (const movement of movementData ?? []) {
    if (!latestMovementByPallet.has(movement.pallet_id)) {
      latestMovementByPallet.set(movement.pallet_id, movement.created_at);
    }
  }

  const now = Date.now();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return pallets
    .map((row) => {
      const pallet = mapPalletRow(row);
      const lastMovementAt = latestMovementByPallet.get(row.id) ?? null;
      const activityAt = lastMovementAt ?? row.created_at;
      const daysWithoutMovement = Math.max(0, Math.floor((now - new Date(activityAt).getTime()) / millisecondsPerDay));
      return { ...pallet, createdAt: row.created_at, lastMovementAt, daysWithoutMovement };
    })
    .filter((pallet) => pallet.daysWithoutMovement >= thresholdDays)
    .sort((left, right) => right.daysWithoutMovement - left.daysWithoutMovement);
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
