"use server";

import { requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { PalletScanDetails, PalletScanResult } from "./types";

/** La RPC vuelve a comprobar empresa, acceso vigente y asignación del chofer. */
export async function getPalletScanDetails(code: string): Promise<PalletScanResult> {
  await requireUserProfile();
  const qrCode = typeof code === "string" ? code.trim() : "";
  if (!qrCode || qrCode.length > 512) return { pallet: null, error: "El código leído no es válido." };
  const db = await createClient();
  const { data, error } = await db.rpc("get_pallet_scan_details", { p_qr_code: qrCode });
  if (error) return { pallet: null, error: "No se pudo consultar la ficha del pallet. Intentá nuevamente." };
  const row = data?.[0] as PalletScanDetails | undefined;
  if (!row) return { pallet: null, error: "El pallet no existe o no está disponible para tu usuario." };
  // Proyección explícita: no serializar nuevos campos de la RPC por accidente.
  return { error: null, pallet: {
    qr_code: row.qr_code, product_name: row.product_name, product_sku: row.product_sku,
    batch_number: row.batch_number, quantity: row.quantity, unit_of_measure: row.unit_of_measure,
    physical_location: row.physical_location, last_event_type: row.last_event_type,
    last_event_at: row.last_event_at, actor_name: row.actor_name, actor_role: row.actor_role,
  } };
}
