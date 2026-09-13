import { createClient } from "@/lib/supabase/server";

export type ScanHistoryItem = { id: string; qrCode: string; createdAt: string; type: "dispatch" | "reception" };

/** Auditoría persistida de QR: complementa el historial inmediato de la sesión. */
export async function getOrderScanHistory(orderId: string, type: "dispatch" | "reception"): Promise<ScanHistoryItem[]> {
  const supabase = await createClient();
  const eventType = type === "dispatch" ? "qr_scan" : "reception";
  const { data, error } = await supabase
    .from("traceability_events")
    .select("id, created_at, details")
    .eq("order_id", orderId)
    .eq("event_type", eventType)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`No se pudo leer el historial de escaneos (${error.code}: ${error.message}).`, { cause: error });
  return (data ?? []).map((event) => {
    const details = event.details as { qr_code?: string } | null;
    return { id: event.id as string, qrCode: details?.qr_code ?? "Pallet", createdAt: event.created_at as string, type };
  });
}
