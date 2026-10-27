"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getErpClient } from "@/lib/erp";
import { describeProcessing, describeRetry, processDueErpEvents, retryFailedErpEvent } from "@/lib/erp-integration/outbox";
import type { IntegrationActionState } from "@/lib/erp-integration/types";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN: IntegrationActionState = { status: "error", message: "Solo logística puede operar la integración con el ERP." };

/** Páginas que muestran el estado de los reportes al ERP. */
function revalidateIntegrationPages() {
  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/[id]", "page");
  revalidatePath("/dashboard");
}

/**
 * Reintenta un reporte de despacho fallido y, si hay ERP configurado, lo envía en el momento (fuera de la
 * transacción del reintento, con timeout). La RPC vuelve a verificar rol, empresa y estado.
 */
export async function retryErpOutboxEvent(eventId: string): Promise<IntegrationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return FORBIDDEN;
  if (typeof eventId !== "string" || !UUID.test(eventId)) {
    return { status: "error", message: "El reporte indicado no es válido." };
  }

  const enabled = await isErpEnabled(profile.companyId);
  const supabase = await createClient();
  const result = await retryFailedErpEvent({
    db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
    eventId,
    getClient: enabled ? () => getErpClient(profile.companyId) : null,
  });
  if (result.outcome === "requeued") revalidateIntegrationPages();
  return describeRetry(result);
}

/** Envía ya los reportes pendientes cuyo backoff venció (hasta PANEL_PROCESS_LIMIT por clic). */
export async function processErpOutboxNow(): Promise<IntegrationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return FORBIDDEN;
  if (!(await isErpEnabled(profile.companyId))) {
    return { status: "error", message: "La integración con el ERP no está configurada (falta ERP_PROVIDER en el servidor)." };
  }

  const supabase = await createClient();
  const result = await processDueErpEvents({
    db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
    getClient: () => getErpClient(profile.companyId),
  });
  if ("error" in result) return { status: "error", message: result.error };
  revalidateIntegrationPages();
  return describeProcessing(result, "No hay reportes pendientes para enviar ahora (los que esperan su próximo reintento se envían cuando vence).");
}
