/**
 * Orden sugerido de salida de pallets según la regla del ERP (TRZ-65). Sin entorno ni red.
 * Es una sugerencia: por producto, el primer pallet de la lista es el que el ERP sacaría primero.
 *   fifo   → el pallet más viejo (alta en TrazFlow)
 *   lifo   → el más nuevo
 *   expiry → el lote que vence antes; los sin vencimiento al final
 */
import type { BatchPickingPolicy } from "../erp/types.ts";
import type { Pallet } from "../types.ts";

export const BATCH_PICKING_POLICY_LABELS: Record<BatchPickingPolicy, string> = {
  fifo: "primero el más antiguo (FIFO)",
  lifo: "primero el más nuevo (LIFO)",
  expiry: "primero el que vence antes",
};

function time(value: string | null | undefined, fallback: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

function compare(a: Pallet, b: Pallet, policy: BatchPickingPolicy): number {
  if (policy === "expiry") {
    const byExpiration = time(a.batchExpirationDate, Number.MAX_SAFE_INTEGER) - time(b.batchExpirationDate, Number.MAX_SAFE_INTEGER);
    if (byExpiration !== 0) return byExpiration;
  }
  const byCreation = time(a.palletCreatedAt, 0) - time(b.palletCreatedAt, 0);
  return policy === "lifo" ? -byCreation : byCreation;
}

/** Agrupa por producto (en el orden en que aparecen) y ordena cada grupo según la regla. */
export function sortPalletsForPicking<T extends Pallet>(pallets: T[], policy: BatchPickingPolicy): T[] {
  const groups = new Map<string, T[]>();
  for (const pallet of pallets) {
    const group = groups.get(pallet.productSku) ?? [];
    group.push(pallet);
    groups.set(pallet.productSku, group);
  }
  return [...groups.values()].flatMap((group) => [...group].sort((a, b) => compare(a, b, policy) || a.qrCode.localeCompare(b.qrCode)));
}

/** Ids de los pallets sugeridos: el primero de cada producto, ya ordenado con sortPalletsForPicking. */
export function suggestedPalletIds(sorted: Pallet[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const pallet of sorted) {
    if (seen.has(pallet.productSku)) continue;
    seen.add(pallet.productSku);
    ids.add(pallet.id);
  }
  return ids;
}
