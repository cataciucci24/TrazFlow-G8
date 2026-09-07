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
