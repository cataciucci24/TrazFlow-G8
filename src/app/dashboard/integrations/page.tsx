import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ActiveFiltersTag, ActivityFilters } from "@/components/erp/integration/activity-filters";
import { ActivityTable } from "@/components/erp/integration/activity-table";
import { ErpConfigForm } from "@/components/erp/integration/erp-config-form";
import { EventDetail } from "@/components/erp/integration/event-detail";
import { IntegrationPageHeader } from "@/components/erp/integration/integration-buttons";
import { IntegrationOverview, IntegrationOverviewFallback } from "@/components/erp/integration/integration-overview";
import { IntegrationTabs } from "@/components/erp/integration/integration-tabs";
import { Pagination } from "@/components/erp/integration/pagination";
import { UnreportedTable } from "@/components/erp/integration/unreported-table";
import { EmptyState, InlineAlert, PageHeader, SectionHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getErpConfigView } from "@/lib/erp-integration/company-config";
import { readStaleAfterHours } from "@/lib/erp-integration/config";
import { buildIntegrationsHref, hasActivityFilters, integrationTabHref, parseIntegrationFilters } from "@/lib/erp-integration/filters";
import {
  getDispatchedUnreported,
  getIntegrationActivity,
  getIntegrationEventDetail,
  getIntegrationSummary,
} from "@/lib/erp-integration/queries";
import { isErpEnabled } from "@/lib/erp-sync/enabled";

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

  // TRZ-112: cada empresa configura su propio ERP desde acá.
  const [configView, erpEnabled] = await Promise.all([
    getErpConfigView(profile.companyId),
    isErpEnabled(profile.companyId),
  ]);
  if (!erpEnabled) {
    return (
      <div className="app-page">
        <PageHeader title="Integración ERP" description="Estado de la conexión, sincronizaciones y reportes de despacho al ERP." />
        <div className="surface">
          <EmptyState title="Tu empresa todavía no tiene un ERP"
            description="Mientras tanto, productos, lotes y órdenes se cargan en TrazFlow. Configurá tu ERP abajo para sincronizar datos y reportar despachos." />
        </div>
        <ErpConfigForm view={configView} />
      </div>
    );
  }

  const params = await searchParams;
  const { filters, problems } = parseIntegrationFilters(params);
  const tab = filters.tab;
  // `volver=resumen`: se llegó al detalle desde una tarjeta del resumen. No usar `from`: es el filtro de fecha.
  const fromSummary = params.volver === "resumen";
  // Cada pestaña lee solo lo que muestra. El resumen de reportes va siempre: alimenta la marca de fallidos.
  const [summary, activity, unreported, detail] = await Promise.all([
    getIntegrationSummary(),
    tab === "actividad" && !filters.event ? getIntegrationActivity(filters) : null,
    tab === "actividad" && !filters.event && !hasActivityFilters(filters) ? getDispatchedUnreported(filters.unreportedPage) : null,
    tab === "actividad" && filters.event ? getIntegrationEventDetail(filters.event.kind, filters.event.id) : null,
  ]);
  const filtered = hasActivityFilters(filters);

  return (
    <div className="app-page">
      <IntegrationPageHeader title="Integración ERP"
        description="Estado de la conexión, sincronizaciones y reportes de despacho al ERP. Detectá fallas sin entrar a la base." />

      <IntegrationTabs active={tab} failed={summary.failedCount} />

      {problems.length > 0 ? (
        <InlineAlert variant="warning"><ul className="list-disc pl-5">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></InlineAlert>
      ) : null}

      {tab === "resumen" ? (
        <Suspense fallback={<IntegrationOverviewFallback />}>
          <IntegrationOverview companyId={profile.companyId} summary={summary} staleAfterHours={readStaleAfterHours()} />
        </Suspense>
      ) : null}

      {tab === "actividad" && filters.event ? (
        // Un evento abierto se muestra solo; "volver" lleva adonde se lo abrió.
        detail
          ? <EventDetail detail={detail} back={fromSummary
              ? { href: integrationTabHref("resumen"), label: "Volver al resumen" }
              : { href: buildIntegrationsHref(filters, { event: null }), label: "Volver a la actividad" }} />
          : <InlineAlert variant="warning">El evento pedido no existe o no pertenece a tu empresa.</InlineAlert>
      ) : null}

      {tab === "actividad" && !filters.event && activity ? (
        <>
          {!filtered && unreported ? (
            <section className="section-stack" aria-labelledby="unreported-title">
              <SectionHeader id="unreported-title" title="Despachadas sin reportar"
                description="Órdenes del ERP que ya salieron físicamente y cuyo despacho todavía no quedó registrado en el ERP." />
              <UnreportedTable rows={unreported.rows}
                detailHref={(eventId) => buildIntegrationsHref(filters, { event: { kind: "dispatch_confirmed", id: eventId } })} />
              <Pagination page={unreported} label="Páginas de despachadas sin reportar"
                hrefFor={(n) => buildIntegrationsHref(filters, { unreportedPage: n })} />
            </section>
          ) : null}

          <section className="section-stack" aria-labelledby="activity-title">
            <SectionHeader id="activity-title" title="Actividad"
              description="Sincronizaciones y reportes de despacho, más recientes primero."
              action={filtered ? <ActiveFiltersTag filters={filters} /> : undefined} />
            {filtered ? null : <ActivityFilters filters={filters} />}
            {activity.outOfRange ? (
              <InlineAlert variant="warning">
                Esa página no existe. <Link href={buildIntegrationsHref(filters, { page: 1 })} className="underline">Ir a la primera página</Link>.
              </InlineAlert>
            ) : (
              <ActivityTable rows={activity.rows}
                detailHref={(row) => buildIntegrationsHref(filters, { event: { kind: row.kind, id: row.id } })}
                emptyTitle={filtered ? "Sin resultados" : "Todavía no hay actividad"}
                emptyDescription={filtered
                  ? "No hay eventos con estos filtros. Quitalos con la cruz de arriba para ver toda la actividad."
                  : "Las sincronizaciones y los reportes de despacho al ERP van a aparecer acá."} />
            )}
            <Pagination page={activity} label="Páginas de actividad" hrefFor={(n) => buildIntegrationsHref(filters, { page: n })} />
          </section>
        </>
      ) : null}

      {tab === "configuracion" ? <ErpConfigForm view={configView} /> : null}
    </div>
  );
}
