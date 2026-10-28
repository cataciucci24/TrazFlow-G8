import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toErpSyncRunSummary, type ErpSyncRunSummary } from "@/lib/erp-sync/types";

const RUN_SELECT = "id, status, provider, started_at, finished_at, counters, errors, notices, error_message";

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
