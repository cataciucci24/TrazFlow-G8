import { buildIntegrationsHref, EMPTY_FILTERS, integrationTabHref } from "./filters.ts";
import type { ActivityKind, ActivityStatus, ErpHealthState, IntegrationBadge, IntegrationSummary, SyncRunStatus } from "./types.ts";

/** Badge de una fila de actividad. Una sincronización parcial cuenta como fallida: tuvo registros con error. */
export function activityBadge(kind: ActivityKind, status: ActivityStatus): IntegrationBadge {
  if (kind === "sync") {
    if (status === "running") return "syncing";
    if (status === "success") return "healthy";
    return "failed";
  }
  if (status === "pending") return "pending";
  if (status === "processing") return "syncing";
  if (status === "sent") return "healthy";
  return "failed";
}

export const DEFAULT_STALE_AFTER_HOURS = 24;

/** Desactualizado: nunca hubo una sincronización exitosa, o la última es más vieja que el umbral. */
export function isSyncStale(lastSuccessAt: string | null, now: Date, staleAfterHours: number): boolean {
  if (!lastSuccessAt) return true;
  const last = Date.parse(lastSuccessAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > staleAfterHours * 3_600_000;
}

export type OverallIntegrationStatus = {
  badge: IntegrationBadge;
  /** Todos los motivos encontrados, el más grave primero. */
  reasons: string[];
};

/**
 * Estado general del panel. Prioridad: fallido > sincronizando > pendiente > desactualizado > saludable.
 * `health` null = todavía no se verificó la conexión (no suma motivos).
 */
export function overallIntegrationStatus(params: {
  health: ErpHealthState | null;
  summary: IntegrationSummary;
  staleAfterHours: number;
  now: Date;
}): OverallIntegrationStatus {
  const { health, summary } = params;
  const failed: string[] = [];
  const syncing: string[] = [];
  const pending: string[] = [];
  const stale: string[] = [];

  if (health?.status === "error") failed.push(`No hay conexión con el ERP: ${health.message}`);
  if (summary.lastRun?.status === "failed") failed.push("La última sincronización falló.");
  if (summary.lastRun?.status === "partial") failed.push("La última sincronización terminó con registros con error.");
  if (summary.failedCount > 0) failed.push(`${summary.failedCount} reporte(s) de despacho fallaron y requieren atención.`);

  if (summary.runningSyncCount > 0) syncing.push("Hay una sincronización en curso.");
  if (summary.processingCount > 0) syncing.push(`${summary.processingCount} reporte(s) se están enviando al ERP.`);

  if (summary.pendingCount > 0) pending.push(`${summary.pendingCount} reporte(s) esperan envío al ERP.`);
  const missing = summary.unreportedCount - summary.pendingCount - summary.processingCount - summary.failedCount;
  if (missing > 0) pending.push(`${missing} orden(es) despachada(s) no tienen reporte al ERP.`);

  if (isSyncStale(summary.lastSuccessAt, params.now, params.staleAfterHours)) {
    stale.push(summary.lastSuccessAt
      ? `La última sincronización exitosa tiene más de ${params.staleAfterHours} h.`
      : "Todavía no hubo una sincronización exitosa.");
  }

  const reasons = [...failed, ...syncing, ...pending, ...stale];
  const badge: IntegrationBadge = failed.length ? "failed"
    : syncing.length ? "syncing"
      : pending.length ? "pending"
        : stale.length ? "stale"
          : "healthy";
  return { badge, reasons };
}

/* ---------- TRZ-112: tarjetas del resumen ---------- */

export type StatusCardTone = "critical" | "caution" | null;

/** Una tarjeta del resumen: qué muestra y adónde lleva al hacer clic. */
export type StatusCard = {
  key: "connection" | "sync" | "reports";
  label: string;
  value: string;
  details: string[];
  tone: StatusCardTone;
  href: string;
  /** Texto del link, al pie de la tarjeta. */
  cta: string;
};

const SYNC_VALUES: Record<SyncRunStatus, { value: string; tone: StatusCardTone }> = {
  running: { value: "En curso", tone: null },
  success: { value: "Exitosa", tone: null },
  partial: { value: "Con errores", tone: "critical" },
  failed: { value: "Fallida", tone: "critical" },
};

/**
 * Las tres tarjetas del resumen (Conexión, Sincronización, Reportes al ERP). Cada una lleva adonde se resuelve lo
 * que muestra: la configuración, el detalle de la última sincronización o la actividad filtrada por lo más urgente.
 * `formatDate` formatea las fechas (la de la app vive en un componente).
 */
export function integrationStatusCards(params: {
  health: ErpHealthState;
  summary: IntegrationSummary;
  staleAfterHours: number;
  now: Date;
  formatDate: (iso: string) => string;
}): StatusCard[] {
  const { health, summary, formatDate } = params;

  const connection: StatusCard = health.status === "ok"
    ? {
        key: "connection", label: "Conexión", value: "Activa", tone: null,
        details: [`${health.provider} · ${health.latencyMs} ms`, `Verificada ${formatDate(health.checkedAt)}`],
        href: integrationTabHref("configuracion"), cta: "Ver configuración",
      }
    : {
        key: "connection", label: "Conexión", value: "Sin conexión", tone: "critical",
        details: [health.message, `Verificada ${formatDate(health.checkedAt)}`],
        href: integrationTabHref("configuracion"), cta: "Revisar configuración",
      };

  const run = summary.lastRun;
  const stale = isSyncStale(summary.lastSuccessAt, params.now, params.staleAfterHours);
  const syncDetails: string[] = [];
  let syncValue = "Nunca";
  let syncTone: StatusCardTone = "caution";
  if (run) {
    ({ value: syncValue, tone: syncTone } = SYNC_VALUES[run.status]);
    syncDetails.push(formatDate(run.finishedAt ?? run.startedAt));
    if (run.status !== "success" && summary.lastSuccessAt) syncDetails.push(`Última exitosa: ${formatDate(summary.lastSuccessAt)}`);
  }
  if (stale && run) {
    syncDetails.push(`Desactualizada (más de ${params.staleAfterHours} h)`);
    syncTone = syncTone ?? "caution";
  }
  if (!run) syncDetails.push("Todavía no se sincronizó con el ERP.");
  const sync: StatusCard = {
    key: "sync", label: "Sincronización", value: syncValue, tone: syncTone, details: syncDetails,
    // `volver=resumen`: el detalle ofrece volver al resumen, que es de donde se vino (`from` es el filtro de fecha).
    href: run
      ? `${buildIntegrationsHref(EMPTY_FILTERS, { tab: "actividad", event: { kind: "sync", id: run.id } })}&volver=resumen`
      : buildIntegrationsHref(EMPTY_FILTERS, { tab: "actividad", kind: "sync" }),
    cta: run ? "Ver detalle" : "Ver sincronizaciones",
  };

  const waiting = summary.pendingCount + summary.processingCount;
  const reportDetails = [`${summary.sentCount} enviados · ${waiting} en espera · ${summary.failedCount} fallidos`];
  if (summary.unreportedCount > 0) reportDetails.push(`${summary.unreportedCount} despachada(s) sin reportar`);
  const dispatches = { ...EMPTY_FILTERS, tab: "actividad" as const, kind: "dispatch_confirmed" as const };
  const reports: StatusCard = summary.failedCount > 0
    ? {
        key: "reports", label: "Reportes al ERP", value: `${summary.failedCount} fallido${summary.failedCount === 1 ? "" : "s"}`,
        tone: "critical", details: reportDetails,
        href: buildIntegrationsHref(dispatches, { status: "failed" }),
        cta: `Ver ${summary.failedCount === 1 ? "el fallido" : "los fallidos"}`,
      }
    : waiting > 0
      ? {
          key: "reports", label: "Reportes al ERP", value: `${waiting} en espera`, tone: "caution", details: reportDetails,
          href: buildIntegrationsHref(dispatches, { status: "pending" }), cta: "Ver los que esperan",
        }
      : {
          key: "reports", label: "Reportes al ERP", value: summary.unreportedCount > 0 ? `${summary.unreportedCount} sin reportar` : "Al día",
          tone: summary.unreportedCount > 0 ? "caution" : null, details: reportDetails,
          href: summary.unreportedCount > 0 ? integrationTabHref("actividad") : buildIntegrationsHref(dispatches),
          cta: summary.unreportedCount > 0 ? "Ver despachadas sin reportar" : "Ver reportes",
        };

  return [connection, sync, reports];
}
