import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { WarehouseLocation, LocationEvent } from "./types";
import { readLocationPages } from "./pagination";
import { attachPalletContents } from "@/lib/pallets/contents";
import { mapPalletRow, PALLET_SELECT, type RawPalletRow } from "@/lib/pallets/mapping";
import type { PalletWithHistory } from "@/lib/types";

export async function getLocations(): Promise<WarehouseLocation[]> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) throw new Error("Sin permiso para consultar ubicaciones.");
  const db = await createClient();
  return readLocationPages<WarehouseLocation>((from, to) => db.from("warehouse_locations").select("*")
    .eq("company_id", profile.companyId).order("code").order("id").range(from, to),
  "No se pudieron consultar las ubicaciones. Verificá que TRZ-96 esté migrada.");
}

/** Consulta exclusiva de esta pantalla; conserva el mapeo y contenido de pallets existente. */
export async function getLocationPallets(): Promise<PalletWithHistory[]> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) throw new Error("Sin permiso para consultar pallets.");
  const db = await createClient();
  type Row = RawPalletRow & { traceability_events: { count: number }[] | null };
  const rows = await readLocationPages<Row>((from, to) => db.from("pallets")
    .select(`${PALLET_SELECT}, traceability_events ( count )`).eq("company_id", profile.companyId)
    .order("qr_code").order("id").range(from, to), "No se pudieron consultar los pallets para ubicar.");
  return (await attachPalletContents(db, rows)).map((row) => ({
    ...mapPalletRow(row), hasHistory: (row.traceability_events?.[0]?.count ?? 0) > 0,
  }));
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
