import "server-only";

import type { ErpClient } from "../erp/client.ts";
import { ErpOutboxClaimError, processErpOutbox, type ErpOutboxDb, type ErpOutboxLogger } from "../erp-outbox/processor.ts";
import type { ErpOutboxRunSummary } from "../erp-outbox/types.ts";
import type { IntegrationActionState } from "./types.ts";

/** Timeout por envío al reintentar desde el panel (el procesador además respeta ERP_TIMEOUT_MS). */
export const PANEL_REPORT_TIMEOUT_MS = 15_000;
/** "Enviar pendientes ahora" manda como mucho esta cantidad por clic, para acotar la duración de la acción. */
export const PANEL_PROCESS_LIMIT = 5;

export type RetryOutcome =
  | { outcome: "requeued"; summary: ErpOutboxRunSummary | null }
  | { outcome: "forbidden" | "not_found" | "not_failed" | "error" };

/**
 * Reintento manual de un reporte fallido: erp_outbox_retry_failed lo vuelve a pending (mismo payload, misma
 * clave, sin evento nuevo) y deja la auditoría. Después, ya fuera de esa transacción, se procesa solo ese
 * reporte con el procesador de US-ERP-04. Si el envío falla, el procesador lo deja en pending (backoff) o
 * en failed; nunca queda en processing más allá del lease.
 */
export async function retryFailedErpEvent(params: {
  db: ErpOutboxDb;
  eventId: string;
  /** null = no procesar ahora (p. ej. sin ERP configurado): queda pendiente. */
  getClient: (() => ErpClient) | null;
  timeoutMs?: number;
  logger?: ErpOutboxLogger;
}): Promise<RetryOutcome> {
  const { data, error } = await params.db.rpc("erp_outbox_retry_failed", { p_event_id: params.eventId });
  if (error) {
    if (error.code === "42501") return { outcome: "forbidden" };
    if (error.code === "P0002") return { outcome: "not_found" };
    if (error.code === "55000") return { outcome: "not_failed" };
    return { outcome: "error" };
  }
  if (typeof data !== "string" || !params.getClient) return { outcome: "requeued", summary: null };

  try {
    const summary = await processErpOutbox({
      db: params.db,
      getClient: params.getClient,
      aggregateId: data,
      limit: 1,
      timeoutMs: params.timeoutMs ?? PANEL_REPORT_TIMEOUT_MS,
      logger: params.logger,
    });
    return { outcome: "requeued", summary };
  } catch {
    // El reporte ya quedó pendiente: lo retoma el próximo procesamiento.
    return { outcome: "requeued", summary: null };
  }
}

/** Procesa ya los reportes vencidos de la empresa (pendientes cuyo backoff llegó). */
export async function processDueErpEvents(params: {
  db: ErpOutboxDb;
  getClient: () => ErpClient;
  limit?: number;
  timeoutMs?: number;
  logger?: ErpOutboxLogger;
}): Promise<ErpOutboxRunSummary | { error: string }> {
  try {
    return await processErpOutbox({
      db: params.db,
      getClient: params.getClient,
      limit: params.limit ?? PANEL_PROCESS_LIMIT,
      timeoutMs: params.timeoutMs ?? PANEL_REPORT_TIMEOUT_MS,
      logger: params.logger,
    });
  } catch (error) {
    return { error: error instanceof ErpOutboxClaimError ? error.message : "No se pudieron procesar los reportes pendientes." };
  }
}

export function describeRetry(result: RetryOutcome): IntegrationActionState {
  switch (result.outcome) {
    case "forbidden":
      return { status: "error", message: "Solo logística puede reintentar reportes al ERP." };
    case "not_found":
      return { status: "error", message: "El reporte no existe o no pertenece a tu empresa." };
    case "not_failed":
      return { status: "warning", message: "Ese reporte ya no está fallido (otro usuario lo reintentó o se envió). Actualizá la página." };
    case "error":
      return { status: "error", message: "No se pudo reintentar el reporte. Intentá nuevamente." };
    case "requeued":
      return describeProcessing(result.summary, "El reporte quedó pendiente y se enviará en el próximo procesamiento.");
  }
}

export function describeProcessing(summary: ErpOutboxRunSummary | null, whenNothing: string): IntegrationActionState {
  if (!summary || summary.claimed === 0) return { status: "warning", message: whenNothing };
  const parts = [
    summary.sent ? `${summary.sent} enviado(s) al ERP` : null,
    summary.duplicates ? `${summary.duplicates} ya estaban registrados en el ERP` : null,
    summary.retrying ? `${summary.retrying} sin respuesta del ERP: se reintentan automáticamente` : null,
    summary.failed ? `${summary.failed} volvieron a fallar: revisá el detalle` : null,
    summary.unrecorded ? `${summary.unrecorded} sin resultado guardado: se retoman en unos minutos` : null,
  ].filter(Boolean);
  const status = summary.failed || summary.unrecorded ? "error" : summary.retrying ? "warning" : "success";
  return { status, message: `${parts.join(" · ")}.` };
}
