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
