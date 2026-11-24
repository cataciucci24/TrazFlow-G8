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
 * TRZ-112: procesa EMPRESA POR EMPRESA. erp_outbox_due_companies lista las empresas con reportes vencidos; para
 * cada una que tenga ERP se procesa con p_company_id y el cliente de SU ERP. Las empresas sin ERP no se tocan: sus
 * eventos quedan pendientes. Backoff, máximo de intentos, lease e idempotencia los sigue decidiendo la base
 * (erp_outbox_claim / mark_*): acá solo se acota el trabajo por ejecución.
 *
 * Presupuesto de tiempo (la función tiene maxDuration = 300 s, el máximo del plan Hobby de Vercel):
 *   - Tandas de OUTBOX_BATCH_SIZE eventos con OUTBOX_REPORT_TIMEOUT_MS por envío: una tanda dura como mucho
 *     5 × 20 s = 100 s, menos que el lease de 2 min, así que nadie retoma un evento que todavía se está enviando.
 *   - No se arranca otra tanda (de ninguna empresa) después de OUTBOX_START_BUDGET_MS (150 s): el peor caso es
 *     150 + 100 s < 300 s.
 *   - Como mucho OUTBOX_MAX_EVENTS por ejecución, sumando todas las empresas; el resto queda para la próxima.
 *   - Si una tanda de una empresa tuvo envíos sin respuesta (su ERP no contesta), se pasa a la siguiente empresa:
 *     un ERP caído no frena los reportes de las demás.
 */

export const OUTBOX_BATCH_SIZE = 5;
export const OUTBOX_REPORT_TIMEOUT_MS = 20_000;
export const OUTBOX_MAX_EVENTS = 250;
export const OUTBOX_START_BUDGET_MS = 150_000;

export type CronResponse<T> = { status: 200 | 401 | 500; body: T };

export type ErpOutboxCronStop = "empty" | "max_events" | "time";

export type ErpOutboxCronBody =
  | { ok: false; error: "unauthorized" | "not_configured" | "claim_failed" }
  | { ok: true; erp: false; message: string }
  | {
      ok: true;
      erp: true;
      /** Empresas con ERP que se procesaron. */
      companies: number;
      /** Empresas cuyo ERP no respondió en esta corrida (sus eventos quedan con backoff). */
      unavailable: number;
      batches: number;
      stoppedBy: ErpOutboxCronStop;
      summary: ErpOutboxRunSummary;
    };

export type ErpOutboxCronParams = {
  authorization: string | null;
  secret: string | undefined;
  /** Cliente con service_role. */
  createDb: () => ErpOutboxDb;
  /** ¿La empresa tiene ERP? (isErpEnabled con service_role). */
  erpEnabled: (companyId: string, db: ErpOutboxDb) => Promise<boolean>;
  /** Cliente del ERP de la empresa. */
  getClient: (companyId: string) => ErpClient | Promise<ErpClient>;
  logger: ErpOutboxLogger;
  process?: typeof processErpOutbox;
  now?: () => number;
};

export async function runErpOutboxCron(params: ErpOutboxCronParams): Promise<CronResponse<ErpOutboxCronBody>> {
  if (!isCronAuthorized(params.authorization, params.secret)) {
    params.logger.warn("outbox_unauthorized", {});
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }

  let db: ErpOutboxDb;
  try {
    db = params.createDb();
  } catch {
    params.logger.error("outbox_not_configured", { code: "config" });
    return { status: 500, body: { ok: false, error: "not_configured" } };
  }

  const listed = await db.rpc("erp_outbox_due_companies", {});
  if (listed.error || !Array.isArray(listed.data)) {
    params.logger.error("outbox_companies_failed", { code: listed.error?.code });
    return { status: 500, body: { ok: false, error: "claim_failed" } };
  }
  const dueCompanies = listed.data.flatMap((row) => {
    const id = row && typeof row === "object" ? (row as { company_id?: unknown }).company_id : null;
    return typeof id === "string" ? [id] : [];
  });

  const companyIds: string[] = [];
  for (const companyId of dueCompanies) {
    try {
      if (await params.erpEnabled(companyId, db)) companyIds.push(companyId);
    } catch {
      params.logger.error("outbox_company_config_failed", { companyId });
    }
  }
  if (dueCompanies.length > 0 && companyIds.length === 0) {
    return { status: 200, body: { ok: true, erp: false, message: "Ninguna empresa con reportes pendientes tiene ERP configurado." } };
  }

  const process = params.process ?? processErpOutbox;
  const now = params.now ?? Date.now;
  const startedAt = now();
  const summary = emptyErpOutboxRunSummary();
  let batches = 0;
  let companies = 0;
  let unavailable = 0;
  let claimFailures = 0;
  let stoppedBy: ErpOutboxCronStop = "empty";

  companiesLoop:
  for (const companyId of companyIds) {
    companies += 1;
    while (true) {
      if (summary.claimed >= OUTBOX_MAX_EVENTS) { stoppedBy = "max_events"; break companiesLoop; }
      if (now() - startedAt >= OUTBOX_START_BUDGET_MS) { stoppedBy = "time"; break companiesLoop; }

      const limit = Math.min(OUTBOX_BATCH_SIZE, OUTBOX_MAX_EVENTS - summary.claimed);
      let batch: ErpOutboxRunSummary;
      try {
        batch = await process({
          db,
          companyId,
          getClient: params.getClient,
          limit,
          timeoutMs: OUTBOX_REPORT_TIMEOUT_MS,
          logger: params.logger,
        });
      } catch (error) {
        // ErpOutboxClaimError: no se tocó nada de esta empresa. Se sigue con la próxima.
        claimFailures += 1;
        params.logger.error("outbox_claim_failed", {
          companyId,
          code: error instanceof ErpOutboxClaimError ? error.code ?? undefined : "unknown",
        });
        break;
      }
      batches += 1;
      for (const key of Object.keys(summary) as (keyof ErpOutboxRunSummary)[]) summary[key] += batch[key];

      // Menos de los pedidos: a esta empresa no le quedan vencidos ahora.
      if (batch.claimed < limit) break;
      if (batch.retrying > 0) {
        unavailable += 1;
        params.logger.warn("outbox_company_erp_unavailable", { companyId });
        break;
      }
    }
  }

  if (batches === 0 && claimFailures > 0) return { status: 500, body: { ok: false, error: "claim_failed" } };

  params.logger.info("outbox_done", { claimed: summary.claimed, status: stoppedBy, durationMs: now() - startedAt });
  return { status: 200, body: { ok: true, erp: true, companies, unavailable, batches, stoppedBy, summary } };
}
