import { createClient } from "@/lib/supabase/server";
import type { OrderNotification } from "@/lib/order-notifications/types";

type RawOrderNotification = {
  id: string;
  event_type: string;
  description: string;
  pallet_id: string | null;
  created_at: string;
};

/**
 * Log de notificaciones de inconsistencias de una orden (US18/TRZ-20).
 * `order_notifications_select` ya filtra por company_id y por
 * `visible_roles`, así que esta query devuelve exactamente lo que le
 * corresponde ver al rol autenticado (logistics_manager o
 * warehouse_operator); para distributor_operator devuelve siempre vacío.
 */
export async function getOrderNotifications(
  orderId: string,
): Promise<OrderNotification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_notifications")
    .select("id, event_type, description, pallet_id, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `No se pudieron leer las notificaciones de la orden (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return ((data ?? []) as RawOrderNotification[]).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    description: row.description,
    palletId: row.pallet_id,
    createdAt: row.created_at,
  }));
}
