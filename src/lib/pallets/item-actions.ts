"use server";

import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { erpStockErrorMessage } from "./erp-stock-errors";
import { warehouseErrorMessage } from "@/lib/warehouses/errors";
import { validPalletItems, type PalletItemInput } from "./item-input";

export async function createPalletWithItems(items: PalletItemInput[], warehouseCode: string) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager", "warehouse_operator")) return { error: "No tenés permisos para armar pallets.", success: null };
  if (!validPalletItems(items)) return { error: "Ingresá entre 1 y 100 lotes distintos con cantidades positivas y hasta dos decimales.", success: null };
  const db = await createClient();
  if (await isErpEnabled(profile.companyId)) {
    const { data, error } = await db.from("batches").select("id, source_system")
      .eq("company_id", profile.companyId).in("id", items.map((item) => item.batch_id));
    if (error || data?.length !== items.length || data.some((lot) => lot.source_system !== "erp")) {
      return { error: "Con ERP, todos los ítems deben usar lotes sincronizados de tu empresa.", success: null };
    }
  }
  const { data, error } = await db.rpc("create_pallet_with_items", { p_items: items, p_warehouse_code: warehouseCode.trim() || null });
  if (error) return { error: erpStockErrorMessage(error) ?? warehouseErrorMessage(error)
    ?? "No se pudo armar el pallet. Revisá lotes, cantidades y unidades.", success: null };
  const code = data?.[0]?.qr_code;
  if (!code) return { error: "No se pudo armar el pallet.", success: null };
  for (const path of ["/dashboard/pallets", "/dashboard/inventory", "/dashboard/orders", "/dashboard/alerts", "/dashboard/traceability"]) revalidatePath(path);
  return { error: null, success: `Pallet ${code} armado con ${items.length} ítem(s) y un único QR.` };
}
