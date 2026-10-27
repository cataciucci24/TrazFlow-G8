import "server-only";

import { toErpStockRow, type ErpStockRow } from "@/lib/erp-stock/types";
import { isBatchPickingPolicy, type BatchPickingPolicy } from "@/lib/erp/types";
import { createClient } from "@/lib/supabase/server";

/** "Stock según ERP" de la empresa del usuario (logística o depósito). La base calcula todo; ver types.ts. */
export async function getErpStockOverview(): Promise<ErpStockRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erp_stock_overview");
  if (error) throw new Error(`No se pudo leer el stock según el ERP (${error.code}).`, { cause: error });
  return ((data ?? []) as Record<string, unknown>[]).map(toErpStockRow);
}

/** Regla de salida de lotes del ERP guardada en la última sincronización (TRZ-65). Sin dato, FIFO. */
export async function getBatchPickingPolicy(companyId: string): Promise<BatchPickingPolicy> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("erp_company_settings")
    .select("batch_picking_policy")
    .eq("company_id", companyId)
    .maybeSingle();
  // La app puede desplegarse antes que la migración: sin tabla, se sugiere FIFO.
  if (error) return "fifo";
  return isBatchPickingPolicy(data?.batch_picking_policy) ? data.batch_picking_policy : "fifo";
}
