import type { Pallet, PalletStatus } from "@/lib/types";

/** Movimiento logístico registrado para un pallet. */
export type PalletMovement = {
  id: string;
  orderId: string | null;
  originLocation: string | null;
  destinationLocation: string;
  resultingStatus: PalletStatus;
  createdAt: string;
};

/** Estado actual del pallet junto con su recorrido logístico. */
export type PalletTraceability = {
  pallet: Pallet;
  movements: PalletMovement[];
};

/** Un pallet del lote junto con su recorrido logístico. */
export type LotPallet = {
  pallet: Pallet;
  movements: PalletMovement[];
};

/** Historial de trazabilidad de un lote: sus datos y todos sus pallets asociados. */
export type LotTraceability = {
  batchId: string;
  batchNumber: string;
  expirationDate: string | null;
  batchQuantity: number;
  productName: string;
  productSku: string;
  pallets: LotPallet[];
};
