import type { ProductUnit } from "@/lib/pallets/units";
import type { OrderStatus } from "@/lib/types";

export type DeliveryDiscrepancyType = "missing" | "surplus" | "damaged" | "wrong_order";
export type DeliveryOutcome =
  | "delivered"
  | "already_processed"
  | "surplus_recorded"
  | "pallet_not_found"
  | "wrong_order"
  | "order_not_found"
  | "invalid_status"
  | "invalid_pallet_status"
  | "invalid_discrepancy_type"
  | "forbidden"
  | "invalid_input"
  | "error";

export type DeliveryPallet = {
  id: string;
  qrCode: string;
  productName: string;
  productSku: string;
  batchNumber: string;
  quantity: number | null;
  unitOfMeasure: ProductUnit;
  deliveryOutcome: "delivered" | "missing" | "damaged" | null;
  processedAt: string | null;
};

export type DeliveryResult = {
  outcome: DeliveryOutcome;
  message: string;
  pallet: Pick<DeliveryPallet, "id" | "qrCode" | "productName" | "productSku" | "batchNumber"> | null;
};

export type AssignedDelivery = {
  id: string;
  recipientName: string;
  status: OrderStatus;
  estimatedDispatchDate: string;
  palletCount: number;
  processedCount: number;
};
