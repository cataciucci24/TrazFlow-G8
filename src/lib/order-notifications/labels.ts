import type { OrderNotificationEventType } from "@/lib/order-notifications/types";

/** Etiquetas legibles para los tipos de notificación conocidos. */
export const ORDER_NOTIFICATION_LABELS: Record<OrderNotificationEventType, string> = {
  dispatch_wrong_pallet: "Pallet incorrecto",
  dispatch_missing_pallets: "Pallets sin validar",
};
