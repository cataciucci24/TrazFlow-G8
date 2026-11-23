"use server";

import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { erpStockErrorMessage } from "./erp-stock-errors";

export async function returnPalletToWarehouse(qrCode: string, reason: string): Promise<{ error: string | null; success: string | null }> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "Solo logística puede registrar reingresos.", success: null };
  if (!qrCode.trim() || qrCode.trim().length > 512 || !reason.trim() || reason.trim().length > 1000) {
    return { error: "Ingresá el QR y un motivo de hasta 1.000 caracteres.", success: null };
  }
  const db = await createClient();
  const { data, error } = await db.rpc("return_pallet_to_warehouse", { p_qr_code: qrCode.trim(), p_reason: reason.trim() });
  if (error) return { error: erpStockErrorMessage(error) ?? "No se pudo registrar el reingreso. Intentá nuevamente.", success: null };
  const outcome = data?.[0]?.outcome as string | undefined;
  if (outcome === "returned" || outcome === "already_in_warehouse") {
    for (const path of ["/dashboard/pallets", "/dashboard/inventory", "/dashboard/orders", "/dashboard/traceability", "/dashboard/alerts"]) revalidatePath(path);
    return { error: null, success: outcome === "returned" ? "Pallet reingresado. Ya está disponible para una nueva orden." : "El pallet ya está en depósito." };
  }
  const errors: Record<string, string> = {
    forbidden: "Solo logística puede registrar reingresos.", invalid_input: "Ingresá el QR y el motivo del reingreso.",
    pallet_not_found: "El pallet no existe o no pertenece a tu empresa.", invalid_status: "Solo se reingresan pallets entregados o con diferencia de entrega.",
    warehouse_inactive: "El depósito original está inactivo. Revisá su configuración antes del reingreso.",
  };
  return { error: errors[outcome ?? ""] ?? "No se pudo registrar el reingreso.", success: null };
}
