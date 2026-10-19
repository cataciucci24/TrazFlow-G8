import type { ActivityKind, ActivityStatus, ErpHealthState, IntegrationBadge, IntegrationSummary } from "./types.ts";

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
