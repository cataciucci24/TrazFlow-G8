import Link from "next/link";

import { formatSyncedAt } from "@/components/erp/erp-origin";
import { getErpClient } from "@/lib/erp";
import { checkErpHealth } from "@/lib/erp-integration/health";
import { integrationStatusCards } from "@/lib/erp-integration/status";
import type { IntegrationSummary } from "@/lib/erp-integration/types";

/**
 * Resumen de la integración (TRZ-112): tres tarjetas (Conexión, Sincronización, Reportes al ERP).
 * Cada tarjeta es un link adonde se resuelve lo que muestra (ver integrationStatusCards). Componente de servidor
 * asíncrono: va dentro de <Suspense> para que el healthcheck (red hacia el ERP) no bloquee el resto del panel.
 */
export async function IntegrationOverview({ companyId, summary, staleAfterHours }: {
  companyId: string;
  summary: IntegrationSummary;
  staleAfterHours: number;
}) {
  const health = await checkErpHealth({ getClient: () => getErpClient(companyId) });
  const now = new Date();
  const cards = integrationStatusCards({ health, summary, staleAfterHours, now, formatDate: formatSyncedAt });

  return (
    <section aria-label="Estado de la integración">
      <ul className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <li key={card.key}>
            <Link href={card.href} className={`status-card ${card.tone ? `status-card-${card.tone}` : ""}`}>
              <span className="status-card-title">{card.label}</span>
              <span className="status-card-status">{card.value}</span>
              {card.details.map((detail) => <span key={detail} className="status-card-detail">{detail}</span>)}
              <span className="status-card-cta">{card.cta} <span aria-hidden="true">→</span></span>
            </Link>
          </li>
        ))}
      </ul>
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
