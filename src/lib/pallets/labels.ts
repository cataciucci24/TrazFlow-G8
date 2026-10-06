import type { PalletStatus } from "@/lib/types";

/** Etiquetas legibles para cada valor del enum `pallet_status`. */
export const PALLET_STATUS_LABELS: Record<PalletStatus, string> = {
  in_warehouse: "En depósito",
  assigned: "Asociado a orden",
  in_transit: "En tránsito",
  received: "Recibido",
  discrepancy: "Con discrepancia",
};
