import type { PalletLocation } from "../locations/format.ts";

export type ValidationOutcome =
  | "validated"
  | "already_validated"
  | "pallet_not_found"
  | "wrong_order"
  | "order_not_found"
  | "forbidden"
  | "invalid_input"
  | "error";

export type PalletValidationResult = {
  outcome: ValidationOutcome;
  message: string;
  pallet: {
    id: string;
    qrCode: string;
    productName: string;
    productSku: string;
    batchNumber: string;
    validatedAt: string;
  } | null;
};

export type OrderPalletValidation = {
  id: string;
  qrCode: string;
  productName: string;
  productSku: string;
  batchNumber: string;
  /** Ubicación física (TRZ-105). null si no tiene o el rol no ve warehouse_locations. */
  location: PalletLocation | null;
  validatedAt: string | null;
  validatedBy: string | null;
};

export type OrderDispatchDiscrepancy = {
  palletId: string | null;
  qrCode: string;
  type: string;
  createdAt: string;
};
