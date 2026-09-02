export type ReceptionOutcome =
  | "received"
  | "already_received"
  | "pallet_not_found"
  | "wrong_order"
  | "order_not_found"
  | "invalid_status"
  | "invalid_pallet_status"
  | "forbidden"
  | "invalid_input"
  | "error";

export type ReceptionPallet = {
  id: string;
  qrCode: string;
  productName: string;
  productSku: string;
  batchNumber: string;
  registeredAt: string | null;
};

export type PalletReceptionResult = {
  outcome: ReceptionOutcome;
  message: string;
  pallet: ReceptionPallet | null;
};

export type OrderPalletReception = {
  id: string;
  qrCode: string;
  productName: string;
  productSku: string;
  batchNumber: string;
  received: boolean;
};
