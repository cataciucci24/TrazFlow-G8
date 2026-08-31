import type { OrderStatus } from "@/lib/types";

/** Etiquetas legibles para cada valor del enum `order_status`. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Pendiente",
  validating: "Validando",
  has_discrepancy: "Con discrepancia",
  confirmed: "Confirmada",
  received: "Recibida",
  received_with_discrepancy: "Recibida con discrepancia",
};
