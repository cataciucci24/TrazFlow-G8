import "server-only";

import type { ErpClient } from "../erp/client.ts";
import {
  ErpOutboxClaimError,
  processErpOutbox,
  type ErpOutboxDb,
  type ErpOutboxLogger,
} from "../erp-outbox/processor.ts";
import { emptyErpOutboxRunSummary, type ErpOutboxRunSummary } from "../erp-outbox/types.ts";
import { isCronAuthorized } from "./auth.ts";

/**
 * Cron del outbox de reportes al ERP (TRZ-104). Lo llama pg_cron (Supabase) cada 5 minutos con
 * `Authorization: Bearer ${CRON_SECRET}` (docs/erp-integration-panel.md, "Procesamiento automático").
 *
 * Procesa con service_role, así que toma los reportes vencidos de todas las empresas. Backoff, máximo de
 * intentos, lease e idempotencia los sigue decidiendo la base (erp_outbox_claim / mark_*): acá solo se acota
 * el trabajo por ejecución.
 *
 * Presupuesto de tiempo (la función tiene maxDuration = 300 s, el máximo del plan Hobby de Vercel):
 *   - Tandas de OUTBOX_BATCH_SIZE eventos con OUTBOX_REPORT_TIMEOUT_MS por envío: una tanda dura como mucho
 *     5 × 20 s = 100 s, menos que el lease de 2 min, así que nadie retoma un evento que todavía se está enviando.
 *   - No se arranca otra tanda después de OUTBOX_START_BUDGET_MS (150 s): el peor caso es 150 + 100 s < 300 s.
 *   - Como mucho OUTBOX_MAX_EVENTS por ejecución; el resto queda para la próxima. Lo que acota de verdad es el
 *     presupuesto de tiempo: este tope alcanza para que una importación grande (USH1) avance.
 *   - Si una tanda tuvo envíos sin respuesta (el ERP no contesta), se corta: no tiene sentido seguir.
 */

export const OUTBOX_BATCH_SIZE = 5;
export const OUTBOX_REPORT_TIMEOUT_MS = 20_000;
export const OUTBOX_MAX_EVENTS = 250;
export const OUTBOX_START_BUDGET_MS = 150_000;

export type CronResponse<T> = { status: 200 | 401 | 500; body: T };

export type ErpOutboxCronBody =
  | { ok: false; error: "unauthorized" | "not_configured" | "claim_failed" }
  | { ok: true; erp: false; message: string }
  | { ok: true; erp: true; batches: number; stoppedBy: "empty" | "max_events" | "time" | "erp_unavailable"; summary: ErpOutboxRunSummary };

export type ErpOutboxCronParams = {
  authorization: string | null;
  secret: string | undefined;
  /** ¿Hay ERP configurado? (isErpEnabled; hoy global). */
  erpEnabled: () => Promise<boolean>;
  /** Cliente con service_role. Se crea solo si hay ERP. */
  createDb: () => ErpOutboxDb;
  getClient: () => ErpClient;
  logger: ErpOutboxLogger;
  process?: typeof processErpOutbox;
  now?: () => number;
};

export async function runErpOutboxCron(params: ErpOutboxCronParams): Promise<CronResponse<ErpOutboxCronBody>> {
  if (!isCronAuthorized(params.authorization, params.secret)) {
    params.logger.warn("outbox_unauthorized", {});
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  if (!(await params.erpEnabled())) {
    return { status: 200, body: { ok: true, erp: false, message: "Sin ERP configurado: no se envía nada." } };
  }

  let db: ErpOutboxDb;
  try {
    db = params.createDb();
  } catch {
    params.logger.error("outbox_not_configured", { code: "config" });
    return { status: 500, body: { ok: false, error: "not_configured" } };
  }

  const process = params.process ?? processErpOutbox;
  const now = params.now ?? Date.now;
  const startedAt = now();
  const summary = emptyErpOutboxRunSummary();
  let batches = 0;
  let stoppedBy: "empty" | "max_events" | "time" | "erp_unavailable" = "empty";

  while (true) {
    if (summary.claimed >= OUTBOX_MAX_EVENTS) { stoppedBy = "max_events"; break; }
    if (now() - startedAt >= OUTBOX_START_BUDGET_MS) { stoppedBy = "time"; break; }

    const limit = Math.min(OUTBOX_BATCH_SIZE, OUTBOX_MAX_EVENTS - summary.claimed);
    let batch: ErpOutboxRunSummary;
    try {
      batch = await process({
        db,
        getClient: params.getClient,
        limit,
        timeoutMs: OUTBOX_REPORT_TIMEOUT_MS,
        logger: params.logger,
      });
    } catch (error) {
      // ErpOutboxClaimError: no se tocó nada. Lo ya enviado en tandas anteriores queda registrado.
      params.logger.error("outbox_claim_failed", { code: error instanceof ErpOutboxClaimError ? error.code ?? undefined : "unknown" });
      if (batches === 0) return { status: 500, body: { ok: false, error: "claim_failed" } };
      break;
    }
    batches += 1;
    for (const key of Object.keys(summary) as (keyof ErpOutboxRunSummary)[]) summary[key] += batch[key];

    // Menos de los pedidos: no quedan vencidos ahora.
    if (batch.claimed < limit) { stoppedBy = "empty"; break; }
    if (batch.retrying > 0) { stoppedBy = "erp_unavailable"; break; }
  }

  params.logger.info("outbox_done", { claimed: summary.claimed, status: stoppedBy, durationMs: now() - startedAt });
  return { status: 200, body: { ok: true, erp: true, batches, stoppedBy, summary } };
}
