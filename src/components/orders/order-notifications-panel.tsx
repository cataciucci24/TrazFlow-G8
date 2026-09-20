import type { OrderNotification } from "@/lib/order-notifications/types";
import { ORDER_NOTIFICATION_LABELS } from "@/lib/order-notifications/labels";

type OrderNotificationsPanelProps = {
  notifications: OrderNotification[];
};

/**
 * Log de notificaciones de inconsistencias de la orden (US18/TRZ-20),
 * visible tanto para logistics_manager como para warehouse_operator. Es
 * solo de lectura: no ofrece ninguna acción correctiva sobre la mercadería,
 * eso queda para la historia de Sprint 2 que reutiliza este mismo log.
 */
export function OrderNotificationsPanel({
  notifications,
}: OrderNotificationsPanelProps) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold">Notificaciones</h2>

      {notifications.length === 0 ? (
        <p className="text-sm text-stone-500">
          No hay inconsistencias registradas para esta orden.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200">
          {notifications.map((notification) => (
            <li key={notification.id} className="flex gap-3 py-3 text-sm">
              <span aria-hidden="true" className="mt-0.5 text-amber-500">
                ⚠
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-950">
                  {ORDER_NOTIFICATION_LABELS[
                    notification.eventType as keyof typeof ORDER_NOTIFICATION_LABELS
                  ] ?? notification.eventType}
                </p>
                <p className="text-stone-600">{notification.description}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-stone-500">
                {new Date(notification.createdAt).toLocaleString("es-AR")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
