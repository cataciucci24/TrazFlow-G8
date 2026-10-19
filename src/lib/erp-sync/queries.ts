import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toErpSyncRunSummary, type ErpSyncRunSummary } from "@/lib/erp-sync/types";

const RUN_SELECT = "id, status, provider, started_at, finished_at, counters, errors, error_message";

/** Última ejecución de la empresa. RLS: solo logística la ve; para otros roles devuelve null. */
export async function getLatestErpSyncRun(companyId: string): Promise<ErpSyncRunSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("erp_sync_runs")
    .select(RUN_SELECT)
    .eq("company_id", companyId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la última sincronización con el ERP (${error.code}).`, { cause: error });
  return data ? toErpSyncRunSummary(data) : null;
}

/** Depósitos del ERP vinculados a un depósito de TrazFlow. */
export async function getErpWarehouseMappings(companyId: string): Promise<{ externalWarehouseId: string; warehouseCode: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("erp_warehouse_mappings")
    .select("external_warehouse_id, warehouse_code")
    .eq("company_id", companyId)
    .order("external_warehouse_id");
  if (error) throw new Error(`No se pudieron leer los depósitos vinculados al ERP (${error.code}).`, { cause: error });
  return (data ?? []).map((row) => ({ externalWarehouseId: row.external_warehouse_id, warehouseCode: row.warehouse_code }));
}
