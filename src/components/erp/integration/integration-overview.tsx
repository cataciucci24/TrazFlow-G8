import { formatSyncedAt } from "@/components/erp/erp-origin";
import { IntegrationBadgeView } from "@/components/erp/integration/integration-badge";
import { getErpClient } from "@/lib/erp";
import { checkErpHealth } from "@/lib/erp-integration/health";
import { overallIntegrationStatus } from "@/lib/erp-integration/status";
import type { IntegrationSummary } from "@/lib/erp-integration/types";

/**
 * Estado general + conexión. Componente de servidor asíncrono: va dentro de <Suspense> para que el
 * healthcheck (red hacia el ERP) no bloquee el resto del panel.
 */
export async function IntegrationOverview({ companyId, summary, staleAfterHours }: {
  companyId: string;
  summary: IntegrationSummary;
  staleAfterHours: number;
}) {
  const health = await checkErpHealth({ getClient: () => getErpClient(companyId) });
  const overall = overallIntegrationStatus({ health, summary, staleAfterHours, now: new Date() });

  return (
    <section className="surface space-y-4 p-4 sm:p-5" aria-labelledby="integration-overview-title">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="integration-overview-title" className="text-base font-semibold text-slate-950">Estado de la integración</h2>
        <IntegrationBadgeView badge={overall.badge} />
      </div>
      {overall.reasons.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
          {overall.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : <p className="text-sm text-stone-600">Conexión activa, sincronización al día y sin reportes pendientes.</p>}
      <dl className="detail-fields grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-stone-500">Conexión con el ERP</dt>
          <dd className="font-medium text-slate-950">
            {health.status === "ok"
              ? `Activa (${health.provider}, ${health.latencyMs} ms)`
              : <span className="text-red-700">Sin conexión: {health.message}</span>}
          </dd>
          <dd className="text-xs text-stone-500">Verificada {formatSyncedAt(health.checkedAt)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Última sincronización exitosa</dt>
          <dd className="font-medium text-slate-950">{summary.lastSuccessAt ? formatSyncedAt(summary.lastSuccessAt) : "Nunca"}</dd>
          <dd className="text-xs text-stone-500">Se considera desactualizada después de {staleAfterHours} h.</dd>
        </div>
        <div>
          <dt className="text-stone-500">Reportes de despacho</dt>
          <dd className="font-medium text-slate-950">
            {summary.sentCount} enviados · {summary.pendingCount + summary.processingCount} en espera · {summary.failedCount} fallidos
          </dd>
          {summary.oldestPendingAt ? <dd className="text-xs text-stone-500">El más antiguo en espera es del {formatSyncedAt(summary.oldestPendingAt)}</dd> : null}
        </div>
        <div>
          <dt className="text-stone-500">Despachadas sin reportar</dt>
          <dd className="font-medium text-slate-950">{summary.unreportedCount}</dd>
        </div>
      </dl>
    </section>
  );
}

export function IntegrationOverviewFallback() {
  return (
    <section className="surface p-4 sm:p-5" aria-busy="true">
      <p role="status" className="text-sm text-stone-500">Verificando la conexión con el ERP…</p>
    </section>
  );
}
