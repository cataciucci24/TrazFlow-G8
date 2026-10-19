import type { PalletStatus } from "@/lib/types";

/** Estados que pueden existir en registros previos al flujo de entrega por chofer. */
export type StoredPalletStatus = PalletStatus | "received" | "discrepancy";

/** Presenta el modelo vigente aun si una base contiene movimientos históricos. */
export function normalizePalletStatus(status: StoredPalletStatus): PalletStatus {
  if (status === "received") return "delivered";
  if (status === "discrepancy") return "delivery_discrepancy";
  return status;
}
