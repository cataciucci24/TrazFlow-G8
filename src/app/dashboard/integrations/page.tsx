import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ErpSyncPanel } from "@/components/erp/erp-sync-panel";
import { ActivityFilters } from "@/components/erp/integration/activity-filters";
import { ActivityTable } from "@/components/erp/integration/activity-table";
import { EventDetail } from "@/components/erp/integration/event-detail";
import { ProcessPendingButton } from "@/components/erp/integration/integration-buttons";
import { IntegrationOverview, IntegrationOverviewFallback } from "@/components/erp/integration/integration-overview";
import { Pagination } from "@/components/erp/integration/pagination";
import { UnreportedTable } from "@/components/erp/integration/unreported-table";
import { EmptyState, InlineAlert, PageHeader, SectionHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { readStaleAfterHours } from "@/lib/erp-integration/config";
import { buildIntegrationsHref, hasActivityFilters, INTEGRATIONS_PATH, parseIntegrationFilters } from "@/lib/erp-integration/filters";
import {
  getDispatchedUnreported,
  getIntegrationActivity,
  getIntegrationEventDetail,
  getIntegrationSummary,
} from "@/lib/erp-integration/queries";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getLatestErpSyncRun } from "@/lib/erp-sync/queries";
import { getWarehouses } from "@/lib/warehouses/queries";

export const metadata: Metadata = { title: "Integración ERP | TrazFlow" };

/**
 * Panel operativo de la integración ERP (US-ERP-05). Solo logística: la página redirige a los demás roles y
 * cada lectura y acción vuelve a verificar el rol en la base. Ver docs/erp-integration-panel.md.
 */
export default async function IntegrationsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");

  if (!(await isErpEnabled(profile.companyId))) {
    return (
      <div className="app-page">
        <PageHeader title="Integración ERP" description="Estado de la conexión, sincronizaciones y reportes de despacho al ERP." />
        <div className="surface">
          <EmptyState title="La integración con el ERP no está configurada"
            description="Definí ERP_PROVIDER en el servidor (por ejemplo, ERP_PROVIDER=mock) para sincronizar maestros y reportar despachos." />
        </div>
      </div>
    );
  }

  const { filters, problems } = parseIntegrationFilters(await searchParams);
  const [summary, lastRun, warehouses, activity, unreported, detail] = await Promise.all([
    getIntegrationSummary(),
    getLatestErpSyncRun(profile.companyId),
    getWarehouses(profile.companyId),
    getIntegrationActivity(filters),
    getDispatchedUnreported(filters.unreportedPage),
    filters.event ? getIntegrationEventDetail(filters.event.kind, filters.event.id) : null,
  ]);
  const filtered = hasActivityFilters(filters);
  const closeDetailHref = buildIntegrationsHref(filters, { event: null });

  return (
    <div className="app-page">
      <PageHeader title="Integración ERP"
        description="Estado de la conexión, sincronizaciones y reportes de despacho al ERP. Detectá fallas sin entrar a la base."
        action={<ProcessPendingButton />} />

      {problems.length > 0 ? (
        <InlineAlert variant="warning"><ul className="list-disc pl-5">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></InlineAlert>
      ) : null}

      <Suspense fallback={<IntegrationOverviewFallback />}>
        <IntegrationOverview companyId={profile.companyId} summary={summary} staleAfterHours={readStaleAfterHours()} />
      </Suspense>

      {filters.event ? (
        detail
          ? <EventDetail detail={detail} closeHref={closeDetailHref} />
          : <InlineAlert variant="warning">El evento pedido no existe o no pertenece a tu empresa.</InlineAlert>
      ) : null}

      <ErpSyncPanel lastRun={lastRun} warehouses={warehouses} />

      <section className="section-stack" aria-labelledby="unreported-title">
        <SectionHeader id="unreported-title" title="Despachadas sin reportar"
          description="Órdenes del ERP que ya salieron físicamente y cuyo despacho todavía no quedó registrado en el ERP." />
        <UnreportedTable rows={unreported.rows}
          detailHref={(eventId) => buildIntegrationsHref(filters, { event: { kind: "dispatch_confirmed", id: eventId } })} />
        <Pagination page={unreported} label="Páginas de despachadas sin reportar"
          hrefFor={(n) => buildIntegrationsHref(filters, { unreportedPage: n })} />
      </section>

      <section className="section-stack" aria-labelledby="activity-title">
        <SectionHeader id="activity-title" title="Actividad"
          description="Sincronizaciones y reportes de despacho, más recientes primero." />
        <ActivityFilters filters={filters} active={filtered} />
        {activity.outOfRange ? (
          <InlineAlert variant="warning">
            Esa página no existe. <Link href={buildIntegrationsHref(filters, { page: 1 })} className="underline">Ir a la primera página</Link>.
          </InlineAlert>
        ) : (
          <ActivityTable rows={activity.rows}
            detailHref={(row) => buildIntegrationsHref(filters, { event: { kind: row.kind, id: row.id } })}
            emptyTitle={filtered ? "Sin resultados para estos filtros" : "Todavía no hay actividad"}
            emptyDescription={filtered
              ? "Cambiá o limpiá los filtros para ver otros eventos."
              : "Las sincronizaciones y los reportes de despacho al ERP van a aparecer acá."}
            emptyAction={filtered ? <Link href={INTEGRATIONS_PATH} className="button-secondary">Limpiar filtros</Link> : undefined} />
        )}
        <Pagination page={activity} label="Páginas de actividad" hrefFor={(n) => buildIntegrationsHref(filters, { page: n })} />
      </section>
    </div>
  );
}
