import { createClient } from "@/lib/supabase/server";
import type { DispatchOrder } from "@/lib/types";

/** Orden de despacho por id, o null si no existe / RLS no la deja ver (otra empresa). */
export async function getDispatchOrderDetail(
  orderId: string,
): Promise<DispatchOrder | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(
      "id, distributor_id, status, estimated_dispatch_date, notes, created_at, distributors ( name )",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `No se pudo leer la orden de despacho (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  if (!data) return null;

  const distributor = Array.isArray(data.distributors)
    ? data.distributors[0]
    : data.distributors;

  return {
    id: data.id,
    distributorId: data.distributor_id,
    distributorName: distributor?.name ?? "—",
    status: data.status,
    estimatedDispatchDate: data.estimated_dispatch_date,
    notes: data.notes,
    createdAt: data.created_at,
  };
}
