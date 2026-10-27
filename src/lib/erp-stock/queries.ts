import "server-only";

import { toErpStockRow, type ErpStockRow } from "@/lib/erp-stock/types";
import { createClient } from "@/lib/supabase/server";

/** "Stock según ERP" de la empresa del usuario (logística o depósito). La base calcula todo; ver types.ts. */
export async function getErpStockOverview(): Promise<ErpStockRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erp_stock_overview");
  if (error) throw new Error(`No se pudo leer el stock según el ERP (${error.code}).`, { cause: error });
  return ((data ?? []) as Record<string, unknown>[]).map(toErpStockRow);
}
