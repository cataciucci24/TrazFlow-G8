import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toWarehouse, type Warehouse } from "@/lib/warehouses/types";

/** Depósitos de la empresa (logística y depósito; para otros roles la RLS devuelve vacío), activos primero. */
export async function getWarehouses(companyId: string): Promise<Warehouse[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("code, name, external_id, source_system, active, synced_at")
    .eq("company_id", companyId)
    .order("active", { ascending: false })
    .order("code");
  if (error) throw new Error(`No se pudieron leer los depósitos (${error.code}).`, { cause: error });
  return (data ?? []).map(toWarehouse);
}

export async function getWarehouseLocationCounts(companyId: string, warehouses: Warehouse[]): Promise<Record<string, number>> {
  const supabase = await createClient();
  const entries = await Promise.all(warehouses.map(async ({ code }) => {
    const { count, error } = await supabase.from("warehouse_locations").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("warehouse_code", code);
    if (error) throw new Error(`No se pudieron contar las ubicaciones (${error.code}).`, { cause: error });
    return [code, count ?? 0] as const;
  }));
  return Object.fromEntries(entries);
}
