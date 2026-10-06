import Link from "next/link";

import { TraceabilitySearch } from "@/components/traceability/traceability-search";
import {
  AlertTypeBadge,
  Badge,
  InlineAlert,
  SectionHeader,
  StatusBadge,
  SummaryCard,
  type AlertStatus,
} from "@/components/ui/design-system";
import type { StockAlertsResult } from "@/lib/stock-alerts/queries";
import type { ExpirationAlert } from "@/lib/types";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const PRIORITY: Record<AlertStatus, number> = { critical: 0, caution: 1, upcoming: 2 };
const ATTENTION_LIMIT = 5;

/** A short operational view of the alert data the dashboard already loads. */
export function LogisticsOverview({ expirationAlerts, stockData }: {
  expirationAlerts: ExpirationAlert[];
  stockData: StockAlertsResult;
}) {
  const attention = [
    ...expirationAlerts.map((alert) => ({
      id: `expiration-${alert.id}`,
      type: "expiration" as const,
      status: (alert.urgency === "warning" ? "caution" : alert.urgency) as AlertStatus,
      title: alert.productName,
      location: alert.currentLocation ?? "Sin ubicación registrada",
      identification: `SKU ${alert.productSku} · Lote ${alert.batchNumber}`,
      detail: `Vence en ${alert.daysRemaining} ${alert.daysRemaining === 1 ? "día" : "días"} · ${NUMBER_FORMATTER.format(alert.quantity)} ${alert.unitOfMeasure} disponibles`,
      href: `/dashboard/traceability?view=lotes&lote=${encodeURIComponent(alert.batchNumber)}`,
      action: "Revisar lote",
    })),
    ...stockData.alerts.map((alert) => ({
      id: `stock-${alert.id}`,
      type: "stock" as const,
      status: alert.riskLevel,
      title: alert.productName,
      location: alert.distributorName,
      identification: `SKU ${alert.productSku}`,
      detail: `${NUMBER_FORMATTER.format(alert.stockDays)} ${alert.stockDays === 1 ? "día" : "días"} de cobertura · ${NUMBER_FORMATTER.format(alert.currentStock)} ${alert.unitOfMeasure} disponibles`,
      href: "/dashboard/alerts",
      action: "Revisar alerta de stock",
    })),
  ].sort((first, second) => PRIORITY[first.status] - PRIORITY[second.status]);
  const criticalCount = attention.filter((alert) => alert.status === "critical").length;
  const cautionCount = attention.filter((alert) => alert.status === "caution").length;
  const upcomingCount = attention.filter((alert) => alert.status === "upcoming").length;

  return (
    <div className="list-content space-y-10">
      <section aria-labelledby="operational-summary-title" className="section-stack">
        <SectionHeader id="operational-summary-title" title="Resumen operativo"
          description="Vencimientos de pallets disponibles y cobertura de stock en distribuidoras." />
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <SummaryCard label="ALERTAS CRÍTICAS" value={criticalCount} tone={criticalCount > 0 ? "critical" : undefined}
            detail={stockData.inventorySourceAvailable ? "Vencimientos y riesgo de quiebre de stock" : "Solo vencimientos; stock no disponible"} />
          <SummaryCard label="PALLETS POR VENCER" value={expirationAlerts.length}
            detail="En depósito, con cantidad disponible y vencimiento dentro de 90 días" />
          <SummaryCard label="ALERTAS DE STOCK" value={stockData.inventorySourceAvailable ? stockData.alerts.length : "—"}
            detail={stockData.inventorySourceAvailable ? "Productos por distribuidora con cobertura de hasta 14 días" : "Fuente no disponible por el momento"} />
        </div>
      </section>

      <section aria-labelledby="attention-title" className="section-stack">
        <SectionHeader id="attention-title" title="Atención requerida"
          description="Primero las situaciones críticas, después las de precaución y los próximos vencimientos."
          action={<Link href="/dashboard/alerts" className="button-primary">Ver todas las alertas</Link>} />
        {!stockData.inventorySourceAvailable && <InlineAlert variant="warning">
          Las alertas de stock no están disponibles por el momento. Este resumen incluye únicamente los vencimientos disponibles.
        </InlineAlert>}
        {attention.length === 0 ? (
          <InlineAlert variant={stockData.inventorySourceAvailable ? "success" : "info"}>
            <p className="font-semibold">{stockData.inventorySourceAvailable ? "Sin alertas activas de stock o vencimiento" : "Sin alertas de vencimiento disponibles"}</p>
            <p className="mt-1">No hay situaciones registradas en las fuentes disponibles que requieran revisión por estos motivos.</p>
          </InlineAlert>
        ) : (
          <div className="surface min-w-0 p-4 sm:p-6">
            <div className="flex flex-wrap gap-2" aria-label="Alertas por prioridad">
              <Badge tone={criticalCount > 0 ? "danger" : "neutral"}>{criticalCount} críticas</Badge>
              <Badge tone={cautionCount > 0 ? "warning" : "neutral"}>{cautionCount} de precaución</Badge>
              <Badge tone={upcomingCount > 0 ? "info" : "neutral"}>{upcomingCount} próximas</Badge>
            </div>
            <ol className="mt-4 divide-y divide-stone-200">
              {attention.slice(0, ATTENTION_LIMIT).map((alert) => (
                <li key={alert.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap gap-2"><StatusBadge status={alert.status} /><AlertTypeBadge type={alert.type} /></div>
                    <p className="font-semibold text-stone-950">{alert.title}</p>
                    <p className="text-sm text-stone-600">{alert.location} · {alert.identification}</p>
                    <p className="text-sm text-stone-600">{alert.detail}</p>
                  </div>
                  <Link href={alert.href} className="button-secondary shrink-0 self-start sm:self-center"
                    aria-label={`${alert.action}: ${alert.title}, ${alert.location}, ${alert.identification}`}>
                    {alert.action}
                  </Link>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm text-stone-500">Mostrando {Math.min(attention.length, ATTENTION_LIMIT)} de {attention.length} alertas. El detalle completo está en Alertas.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="operational-access-title" className="section-stack">
        <SectionHeader id="operational-access-title" title="Continuar la operación"
          description="Revisá los envíos o consultá la mercadería antes de decidir el próximo paso." />
        <div className="surface min-w-0 p-4 sm:p-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <h3 className="font-semibold">Envíos y disponibilidad</h3>
              <p className="text-sm text-stone-500">Consultá el estado de los despachos y dónde está la mercadería.</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/dashboard/orders" className="button-secondary">Revisar órdenes</Link>
                <Link href="/dashboard/pallets" className="button-secondary">Consultar pallets</Link>
                <Link href="/dashboard/inventory" className="button-secondary">Consultar stock</Link>
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              <h3 className="font-semibold">Planificar la mercadería</h3>
              <p className="text-sm text-stone-500">Revisá lotes y mercadería sin movimiento para evaluar prioridades.</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/dashboard/lots" className="button-secondary">Revisar lotes</Link>
                <Link href="/dashboard/stagnant" className="button-secondary">Detectar inmovilizaciones</Link>
              </div>
            </div>
          </div>
          <div className="mt-6 min-w-0 space-y-3 border-t border-stone-200 pt-6">
            <h3 className="font-semibold">Consultar el recorrido de un pallet</h3>
            <TraceabilitySearch defaultQr="" palletCodes={[]} />
          </div>
        </div>
      </section>
    </div>
  );
}
