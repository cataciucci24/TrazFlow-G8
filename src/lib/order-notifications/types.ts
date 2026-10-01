/**
 * Tipos de inconsistencia que escriben los RPCs de despacho y recepción en
 * `order_notifications` (US18/TRZ-20). Es texto libre en la base para no
 * tener que migrar un enum por cada tipo nuevo, pero acá se listan los
 * valores conocidos para poder tipar el label en la UI.
 */
export type OrderNotificationEventType =
  | "dispatch_wrong_pallet"
  | "dispatch_missing_pallets"
  | "reception_wrong_pallet"
  | "reception_reported_discrepancy";

/** Fila del log de notificaciones de una orden, visible por rol vía RLS. */
export type OrderNotification = {
  id: string;
  eventType: OrderNotificationEventType | string;
  description: string;
  palletId: string | null;
  createdAt: string;
};
