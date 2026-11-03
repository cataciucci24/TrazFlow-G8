"use server";

import { after } from "next/server";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { processCompanyErpOutbox } from "@/lib/erp-outbox/run";
import { createClient } from "@/lib/supabase/server";

export type ErpStockEntryState = { error: string | null; success: string | null };

const MESSAGES: Record<string, string> = {
  forbidden: "No tenés permisos para informar movimientos de stock.",
  invalid_input: "Revisá el tipo, la cantidad (mayor a 0) y el motivo (hasta 200 caracteres).",
  lot_not_found: "El lote no viene del ERP: no se puede informar.",
  warehouse_not_mapped: "Ese depósito no está vinculado a ningún depósito del ERP.",
  error: "No se pudo registrar el movimiento. Probá de nuevo.",
};

/**
 * TRZ-62: pide al ERP un alta (recepción) o una baja (ajuste) de un lote en un depósito. Queda en el outbox y se
 * manda en un after(); en el ERP queda en borrador hasta que lo confirman ahí.
 */
export async function requestErpStockEntry(_: ErpStockEntryState, form: FormData): Promise<ErpStockEntryState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager") && !hasRole(profile, "warehouse_operator")) {
    return { error: MESSAGES.forbidden, success: null };
  }
  const [batchId, warehouseCode] = String(form.get("lot") ?? "").split("|");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_erp_stock_entry", {
    p_batch_id: batchId || null,
    p_warehouse_code: warehouseCode ?? "",
    p_entry_type: String(form.get("entryType") ?? ""),
    p_quantity: Number(form.get("quantity")),
    p_reason: String(form.get("reason") ?? ""),
  });
  const outcome = error ? "error" : ((data?.[0]?.outcome as string | undefined) ?? "error");
  if (outcome !== "requested") return { error: MESSAGES[outcome] ?? MESSAGES.error, success: null };

  after(() =>
    processCompanyErpOutbox({
      db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
      companyId: profile.companyId,
    }),
  );
  return { error: null, success: "Enviado al ERP como borrador. El stock cambia cuando lo confirmen en el ERP." };
}
