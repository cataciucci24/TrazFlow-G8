"use server";
import { revalidatePath } from "next/cache";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { normalizeLocationCode, validLocationCode } from "./rules";
import { locationErrorMessage } from "./errors";
import { warehouseErrorMessage } from "@/lib/warehouses/errors";
import type { LocationActionState } from "./types";

export async function createLocation(_previous: LocationActionState, form: FormData): Promise<LocationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) return { error: "Sin permiso para crear ubicaciones.", success: null };
  const code = normalizeLocationCode(String(form.get("code") ?? ""));
  const aisle = String(form.get("aisle") ?? "").trim();
  const rack = String(form.get("rack") ?? "").trim();
  const level = String(form.get("level") ?? "").trim();
  const position = String(form.get("position") ?? "").trim();
  // Con varios depósitos el formulario manda el elegido (TRZ-101); con uno solo, lo completa la base.
  const warehouseCode = String(form.get("warehouseCode") ?? "").trim();
  if (!validLocationCode(code) || [aisle, rack, level, position].some((s) => !s || s.length > 40)) {
    return { error: "Completá las coordenadas (hasta 40 caracteres) y un código de hasta 40 letras, números, guiones o guiones bajos.", success: null };
  }
  const db = await createClient();
  const { error } = await db.from("warehouse_locations").insert({
    company_id: profile.companyId, code, aisle, rack, level, position,
    ...(warehouseCode ? { warehouse_code: warehouseCode } : {}),
  });
  if (error) return { error: warehouseErrorMessage(error) ?? locationErrorMessage(error, "create"), success: null };
  revalidatePath("/dashboard/locations");
  return { success: "Ubicación creada.", error: null };
}
export async function assignLocation(_previous: LocationActionState, form: FormData): Promise<LocationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator")) return { error: "Solo un operador de depósito puede registrar movimientos.", success: null };
  const palletId = String(form.get("palletId") ?? "");
  const locationId = String(form.get("locationId") ?? "");
  const expected = String(form.get("expectedLocationId") ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(palletId) || !uuid.test(locationId) || (expected && !uuid.test(expected))) return { error: "Seleccioná un pallet y una ubicación válidos.", success: null };
  const db = await createClient();
  const { error } = await db.rpc("assign_pallet_location", { p_pallet_id: palletId, p_location_id: locationId, p_expected_location_id: expected || null });
  if (error) return { error: warehouseErrorMessage(error) ?? locationErrorMessage(error, "move"), success: null };
  revalidatePath("/dashboard", "layout");
  return { error: null, success: "Movimiento registrado y ubicación actualizada." };
}
