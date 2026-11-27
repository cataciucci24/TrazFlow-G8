"use server";
import { revalidatePath } from "next/cache";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { normalizeLocationCode, validLocationCode } from "./rules";
import { locationErrorMessage } from "./errors";
import { warehouseErrorMessage } from "@/lib/warehouses/errors";
import type { LocationActionState } from "./types";
import { expandLocationRange, generatedLocationCode, locationCombinations } from "./generation";
import { parseWarehouseLayout } from "@/lib/warehouses/layout";
import { parseLocationCoordinates } from "./coordinates";

export async function createLocation(_previous: LocationActionState, form: FormData): Promise<LocationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) return { error: "Sin permiso para crear ubicaciones.", success: null };
  const code = normalizeLocationCode(String(form.get("code") ?? ""));
  const warehouseCode = String(form.get("warehouseCode") ?? "").trim();
  if (!validLocationCode(code) || (warehouseCode && !validLocationCode(warehouseCode))) return { error: "Revisá el código de la ubicación y del depósito.", success: null };
  const db = await createClient();
  let query = db.from("warehouses").select("code, layout, active").eq("company_id", profile.companyId);
  query = warehouseCode ? query.eq("code", warehouseCode) : query.eq("active", true);
  const { data: warehouses, error: queryError } = await query.limit(2);
  if (queryError || !warehouses || warehouses.length !== 1) return { error: "Seleccioná un depósito activo de tu empresa.", success: null };
  const warehouse = warehouses[0];
  if (!warehouse.active) return { error: "El depósito está inactivo.", success: null };
  const layout = parseWarehouseLayout(warehouse.layout);
  const coordinates = layout && parseLocationCoordinates(form, layout.length);
  if (!coordinates) return { error: "Completá solo los niveles configurados, con hasta 40 caracteres por coordenada.", success: null };
  const { error } = await db.from("warehouse_locations").insert({
    company_id: profile.companyId, code, warehouse_code: warehouse.code, ...coordinates,
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

export type GenerateLocationsState = { error: string | null; success: string | null; created?: number; skipped?: number; rejected?: number };

export async function generateLocations(_previous: GenerateLocationsState, form: FormData): Promise<GenerateLocationsState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "Solo logística puede generar ubicaciones.", success: null };
  const warehouseCode = String(form.get("warehouseCode") ?? "").trim();
  if (!validLocationCode(warehouseCode)) return { error: "Seleccioná un depósito válido.", success: null };
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("layout") ?? "")); } catch { raw = null; }
  const layout = parseWarehouseLayout(raw);
  if (!layout) return { error: "La distribución no es válida. Actualizá la página.", success: null };
  const ranges = layout.map((_, index) => expandLocationRange(String(form.get(`start${index}`) ?? ""), String(form.get(`end${index}`) ?? "")));
  if (ranges.some((range) => range === null)) return { error: "Revisá los rangos: usá letras A–Z o números ascendentes.", success: null };
  const combinations = locationCombinations(ranges as string[][]);
  if (!combinations) return { error: "La operación admite entre 1 y 2.000 ubicaciones.", success: null };
  const items = combinations.map((values) => ({ code: generatedLocationCode(warehouseCode, values), aisle: values[0], rack: values[1] ?? null, level: values[2] ?? null, position: values[3] ?? null }));
  const db = await createClient();
  const { data, error } = await db.rpc("generate_warehouse_locations", { p_warehouse_code: warehouseCode, p_expected_layout: layout, p_items: items });
  if (error) {
    if (error.code === "40001") return { error: "La distribución cambió. Actualizá la página y revisá los rangos.", success: null };
    return { error: warehouseErrorMessage(error) ?? locationErrorMessage(error, "create"), success: null };
  }
  const result = data?.[0];
  if (!result || !Number.isInteger(result.created) || !Number.isInteger(result.skipped) || !Number.isInteger(result.rejected)) {
    return { error: "No se pudo confirmar el resultado. Actualizá el catálogo antes de reintentar.", success: null };
  }
  revalidatePath("/dashboard/locations");
  return { error: null, success: "Generación finalizada.", created: result.created, skipped: result.skipped, rejected: result.rejected };
}
