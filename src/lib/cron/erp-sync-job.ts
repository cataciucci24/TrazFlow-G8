import "server-only";

import type { ErpClient } from "../erp/client.ts";
import type { ErpOutboxLogger } from "../erp-outbox/processor.ts";
import { ErpSyncStartError, syncCompanyFromErp, type ErpSyncDb } from "../erp-sync/sync.ts";
import type { ErpSyncStatus } from "../erp-sync/types.ts";
import { isCronAuthorized } from "./auth.ts";
import type { CronResponse } from "./erp-outbox-job.ts";

/**
 * Cron de la sincronización automática con el ERP (TRZ-104). Lo llama pg_cron (Supabase) cada 15 minutos con
 * `Authorization: Bearer ${CRON_SECRET}`. Por cada empresa con ERP corre la misma syncCompanyFromErp que el
 * botón "Sincronizar" (remitos → depósitos → productos → lotes → saldos → órdenes), con service_role y sin
 * usuario: la ejecución queda como `automatic` y sin triggered_by.
 *
 * Qué empresas: las que devuelve erp_sync_auto_companies (al menos una sincronización previa o un depósito
 * vinculado al ERP), primero las que hace más que no se sincronizan. Mientras isErpEnabled sea global, eso
 * alcanza; con configuración por empresa habrá que filtrar acá con isErpEnabled(companyId).
 *
 * Límites: una empresa a la vez y no se arranca otra después de SYNC_START_BUDGET_MS (120 s), dentro de los
 * 300 s de maxDuration. Una sincronización de una empresa no se parte: con ERPNext, pullMasterData hace una
 * llamada de stock por producto (cada una con ERP_TIMEOUT_MS). Las empresas que no entraron van primero la
 * próxima vez. Si una empresa ya tiene una sincronización en curso (manual o de otro cron), se saltea sin error.
 */

export const SYNC_START_BUDGET_MS = 120_000;

export type ErpSyncCronCompanyResult = {
  companyId: string;
  result: ErpSyncStatus | "skipped_running" | "skipped_time" | "error";
  runId: string | null;
};

export type ErpSyncCronBody =
  | { ok: false; error: "unauthorized" | "not_configured" | "companies_failed" }
  | { ok: true; erp: false; message: string }
  | { ok: true; erp: true; companies: ErpSyncCronCompanyResult[] };

export type ErpSyncCronParams = {
  authorization: string | null;
  secret: string | undefined;
  erpEnabled: () => Promise<boolean>;
  /** Cliente con service_role. Se crea solo si hay ERP. */
  createDb: () => ErpSyncDb;
  getClient: (companyId: string) => ErpClient;
  provider: string;
  logger: ErpOutboxLogger;
  sync?: typeof syncCompanyFromErp;
  now?: () => number;
};

export async function runErpSyncCron(params: ErpSyncCronParams): Promise<CronResponse<ErpSyncCronBody>> {
  if (!isCronAuthorized(params.authorization, params.secret)) {
    params.logger.warn("sync_unauthorized", {});
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  if (!(await params.erpEnabled())) {
    return { status: 200, body: { ok: true, erp: false, message: "Sin ERP configurado: no se sincroniza." } };
  }

  let db: ErpSyncDb;
  try {
    db = params.createDb();
  } catch {
    params.logger.error("sync_not_configured", { code: "config" });
    return { status: 500, body: { ok: false, error: "not_configured" } };
  }

  const listed = await db.rpc("erp_sync_auto_companies", {});
  if (listed.error || !Array.isArray(listed.data)) {
    params.logger.error("sync_companies_failed", { code: listed.error?.code });
    return { status: 500, body: { ok: false, error: "companies_failed" } };
  }
  const companyIds = listed.data.flatMap((row) => {
    const id = row && typeof row === "object" ? (row as { company_id?: unknown }).company_id : null;
    return typeof id === "string" ? [id] : [];
  });

  const sync = params.sync ?? syncCompanyFromErp;
  const now = params.now ?? Date.now;
  const startedAt = now();
  const companies: ErpSyncCronCompanyResult[] = [];

  for (const companyId of companyIds) {
    if (now() - startedAt >= SYNC_START_BUDGET_MS) {
      companies.push({ companyId, result: "skipped_time", runId: null });
      continue;
    }
    const companyStartedAt = now();
    try {
      const run = await sync({
        db,
        companyId,
        actorId: null,
        provider: params.provider,
        getClient: () => params.getClient(companyId),
      });
      companies.push({ companyId, result: run.status, runId: run.id });
      params.logger.info("sync_company_done", { status: run.status, durationMs: now() - companyStartedAt });
    } catch (error) {
      if (error instanceof ErpSyncStartError && error.code === "55P03") {
        companies.push({ companyId, result: "skipped_running", runId: null });
        params.logger.info("sync_company_skipped", { status: "running" });
        continue;
      }
      companies.push({ companyId, result: "error", runId: null });
      params.logger.error("sync_company_failed", {
        code: error instanceof ErpSyncStartError ? error.code ?? undefined : "unknown",
        durationMs: now() - companyStartedAt,
      });
    }
  }

  return { status: 200, body: { ok: true, erp: true, companies } };
}
