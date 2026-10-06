import type { OrderDispatchDiscrepancy } from "./types.ts";

/** Asociación o desasociación de un pallet a la orden (pallet_associated / pallet_dissociated). */
export type OrderCompositionChange = {
  palletId: string | null;
  createdAt: string;
};

/**
 * Decide qué discrepancias de despacho se muestran como inconsistencia activa.
 * El evento sigue en traceability_events como auditoría; una discrepancia
 * deja de mostrarse cuando:
 * - la orden no tiene pallets (no hay nada que despachar), o
 * - el pallet escaneado ya pertenece a la orden, o
 * - ese mismo pallet se asoció o desasoció de la orden después del escaneo
 *   (el responsable logístico ya intervino sobre él).
 */
export function filterActiveDispatchDiscrepancies(
  discrepancies: OrderDispatchDiscrepancy[],
  orderPalletIds: string[],
  compositionChanges: OrderCompositionChange[],
): OrderDispatchDiscrepancy[] {
  if (orderPalletIds.length === 0) return [];

  return discrepancies.filter((discrepancy) => {
    if (!discrepancy.palletId) return true;
    if (orderPalletIds.includes(discrepancy.palletId)) return false;
    const scannedAt = Date.parse(discrepancy.createdAt);
    return !compositionChanges.some(
      (change) => change.palletId === discrepancy.palletId && Date.parse(change.createdAt) > scannedAt,
    );
  });
}
