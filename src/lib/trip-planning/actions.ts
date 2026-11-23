"use server";
import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type VehicleActionState = { error: string | null; success: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CAPACITY = 99;

/** TRZ-71: alta o cambio del vehículo de un chofer (uno por chofer). */
export async function saveDriverVehicle(_previous: VehicleActionState, form: FormData): Promise<VehicleActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "Solo logística puede cargar vehículos.", success: null };

  const driverId = String(form.get("driverId") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const capacity = Number(form.get("capacityPallets"));
  if (!UUID.test(driverId)) return { error: "Elegí un chofer.", success: null };
  if (!name || name.length > 60) return { error: "Completá el nombre o la patente (hasta 60 caracteres).", success: null };
  if (!Number.isInteger(capacity) || capacity <= 0 || capacity > MAX_CAPACITY) {
    return { error: `La capacidad tiene que ser un número entero de pallets entre 1 y ${MAX_CAPACITY}.`, success: null };
  }

  const db = await createClient();
  const { error } = await db.from("driver_vehicles").upsert(
    { company_id: profile.companyId, driver_id: driverId, name, capacity_pallets: capacity },
    { onConflict: "driver_id" },
  );
  if (error) {
    return { error: error.code === "23514" ? "El vehículo tiene que ser de un chofer activo de la empresa." : "No se pudo guardar el vehículo.", success: null };
  }
  revalidatePath("/dashboard/trip-planning");
  return { error: null, success: "Vehículo guardado." };
}
