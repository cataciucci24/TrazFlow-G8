import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { WarehouseLocation, LocationEvent } from "./types";

export async function getLocations(): Promise<WarehouseLocation[]> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) throw new Error("Sin permiso para consultar ubicaciones.");
  const db = await createClient();
  const { data, error } = await db.from("warehouse_locations").select("*").eq("company_id", profile.companyId).order("code");
  if (error) throw new Error("No se pudieron consultar las ubicaciones. Verificá que TRZ-96 esté migrada.", { cause: error });
  return data ?? [];
}
export async function getLocationEvents(palletId: string): Promise<LocationEvent[]> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) throw new Error("Sin permiso.");
  const db = await createClient();
  const { data, error } = await db.from("traceability_events")
    .select("id, event_type, created_at, user_id, details")
    .eq("company_id", profile.companyId).eq("pallet_id", palletId)
    .in("event_type", ["location_assigned", "location_changed"])
    .order("created_at").order("id");
  if (error) throw new Error("No se pudo consultar el historial de ubicaciones.", { cause: error });
  return (data ?? []) as LocationEvent[];
}
