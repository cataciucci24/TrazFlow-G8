"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  CompactSummaryCard,
  EmptyState,
  InlineAlert,
  SectionHeader,
  StatusBadge,
  TableShell,
  type AlertStatus,
  type AlertType,
  type CompactSummaryTone,
} from "@/components/ui/design-system";
import { ExpirationThresholdsForm } from "@/components/dashboard/expiration-thresholds-form";
import type { DistributorStockAlert, ExpirationAlert, ExpirationThresholds } from "@/lib/types";

// Dónde está la mercadería: las alertas de stock siempre son de distribuidoras.
type AlertOrigin = ExpirationAlert["source"];

const ORIGIN_LABELS: Record<AlertOrigin, string> = { warehouse: "Depósito", distributor: "Distribuidora" };

type UnifiedAlert = {
  id: string;
  type: AlertType;
  status: AlertStatus;
  productName: string;
  productSku: string;
  batchNumber?: string;
  location: string;
  origin: AlertOrigin;
  situation: string;
  supportingDetail: string;
  href: string;
};

// Mismos colores que los badges de estado de la tabla.
const statusCards: { value: AlertStatus; label: string; tone: CompactSummaryTone }[] = [
  { value: "critical", label: "Crítico", tone: "red" },
  { value: "caution", label: "Precaución", tone: "amber" },
  { value: "upcoming", label: "Próximo", tone: "sky" },
];

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

function pluralizeAlert(count: number) {
  return `${count} ${count === 1 ? "alerta" : "alertas"}`;
}

function unifyAlerts(expirationAlerts: ExpirationAlert[], stockAlerts: DistributorStockAlert[]): UnifiedAlert[] {
  const expirations: UnifiedAlert[] = expirationAlerts.map((alert) => ({
    id: `expiration-${alert.id}`,
    type: "expiration",
    status: alert.urgency === "warning" ? "caution" : alert.urgency,
    productName: alert.productName,
    productSku: alert.productSku,
    batchNumber: alert.batchNumber,
    location: alert.currentLocation ?? "Sin ubicación registrada",
    origin: alert.source,
    situation: `Vence en ${alert.daysRemaining} ${alert.daysRemaining === 1 ? "día" : "días"}`,
    supportingDetail: `${NUMBER_FORMATTER.format(alert.quantity)} ${alert.unitOfMeasure} disponibles`,
    href: `/dashboard/traceability?view=lotes&lote=${encodeURIComponent(alert.batchNumber)}`,
  }));

  const stocks: UnifiedAlert[] = stockAlerts.map((alert) => ({
    id: `stock-${alert.id}`,
    type: "stock",
    status: alert.riskLevel === "critical" ? "critical" : "caution",
    productName: alert.productName,
    productSku: alert.productSku,
    location: alert.distributorName,
    origin: "distributor",
    situation: `${NUMBER_FORMATTER.format(alert.stockDays)} ${alert.stockDays === 1 ? "día" : "días"} de stock restantes`,
    supportingDetail: `${NUMBER_FORMATTER.format(alert.currentStock)} ${alert.unitOfMeasure} disponibles · ${NUMBER_FORMATTER.format(alert.dailyConsumption)} ${alert.unitOfMeasure} de consumo diario`,
    href: `/dashboard/inventory?search=${encodeURIComponent(alert.productSku)}`,
  }));

  const order: Record<AlertStatus, number> = { critical: 0, caution: 1, upcoming: 2 };
  return [...expirations, ...stocks].sort((first, second) => order[first.status] - order[second.status]);
}

export function AlertsCenter({
  expirationAlerts,
  stockAlerts,
  inventorySourceAvailable,
  thresholds,
}: {
  expirationAlerts: ExpirationAlert[];
  stockAlerts: DistributorStockAlert[];
  inventorySourceAvailable: boolean;
  thresholds: ExpirationThresholds;
}) {
  const [typeFilter, setTypeFilter] = useState<"all" | AlertType>("all");
  const [originFilter, setOriginFilter] = useState<"all" | AlertOrigin>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AlertStatus>("all");
  const alerts = useMemo(() => unifyAlerts(expirationAlerts, stockAlerts), [expirationAlerts, stockAlerts]);
  const filteredAlerts = alerts.filter((alert) =>
    (typeFilter === "all" || alert.type === typeFilter) &&
    (originFilter === "all" || alert.origin === originFilter) &&
    (statusFilter === "all" || alert.status === statusFilter),
  );
  const counts = {
    critical: alerts.filter((alert) => alert.status === "critical").length,
    caution: alerts.filter((alert) => alert.status === "caution").length,
    upcoming: alerts.filter((alert) => alert.status === "upcoming").length,
  };

  return (
    <div className="space-y-10">
      <section aria-labelledby="alert-summary-title" className="section-stack">
        <SectionHeader
          id="alert-summary-title"
          title="Resumen de alertas"
          description="Tocá una prioridad para filtrar las alertas activas."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {statusCards.map((card) => {
            const isActive = statusFilter === card.value;
            return (
              <CompactSummaryCard
                key={card.value}
                label={card.label}
                value={counts[card.value]}
                tone={card.tone}
                pressed={isActive}
                onClick={() => setStatusFilter(isActive ? "all" : card.value)}
              />
            );
          })}
        </div>
        <ExpirationThresholdsForm thresholds={thresholds} />
      </section>

      <section aria-labelledby="active-alerts-title" className="section-stack">
        <SectionHeader
          id="active-alerts-title"
          title="Alertas activas"
          description="Situaciones detectadas que requieren seguimiento."
          action={<p className="text-sm text-slate-500">{pluralizeAlert(filteredAlerts.length)}</p>}
        />

        <div className="filter-panel flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <FilterGroup
              label="Tipo de alerta"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all", label: "Todos" },
                { value: "expiration", label: "Vencimiento" },
                { value: "stock", label: "Stock" },
              ]}
            />
            <FilterGroup
              label="Ubicación"
              value={originFilter}
              onChange={setOriginFilter}
              options={[
                { value: "all", label: "Todas" },
                { value: "warehouse", label: "Depósito" },
                { value: "distributor", label: "Distribuidora" },
              ]}
            />
          </div>

          {!inventorySourceAvailable ? (
            <InlineAlert variant="warning">
              Las alertas de stock no están disponibles por el momento. Las alertas de vencimiento siguen visibles.
            </InlineAlert>
          ) : null}

          {filteredAlerts.length === 0 ? (
            <EmptyState
              title={alerts.length === 0 ? "Sin alertas activas disponibles" : "Sin resultados para estos filtros"}
              description={alerts.length === 0 ? "No hay situaciones registradas que requieran atención en las fuentes disponibles." : "Probá con otro tipo, ubicación o prioridad para consultar las situaciones activas."}
              action={alerts.length > 0 ? <button type="button" className="button-secondary" onClick={() => { setTypeFilter("all"); setOriginFilter("all"); setStatusFilter("all"); }}>Limpiar filtros</button> : undefined}
            />
          ) : (
            <TableShell label="Listado unificado de alertas activas" mobileLayout="rows">
              <table role="table" aria-label="Alertas activas" className="data-table min-w-[840px]">
                <caption className="sr-only">Alertas activas de stock y vencimiento</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">Producto</th>
                    <th role="columnheader" scope="col">Ubicación</th>
                    <th role="columnheader" scope="col">Situación</th>
                    <th role="columnheader" scope="col">Estado</th>
                    <th role="columnheader" scope="col" className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {filteredAlerts.map((alert) => (
                    <tr role="row" key={alert.id} className={`alert-row-${alert.status}`}>
                      <td role="cell" data-label="Producto" className="mobile-primary">
                        <p className="font-semibold text-slate-950">{alert.productName}</p>
                        <p className="table-secondary font-mono">
                          {alert.productSku}{alert.batchNumber ? ` · Lote ${alert.batchNumber}` : ""}
                        </p>
                      </td>
                      <td role="cell" data-label="Ubicación" className="mobile-priority max-w-56 text-slate-600">
                        <p>{alert.location}</p>
                        <p className="table-secondary">{ORIGIN_LABELS[alert.origin]}</p>
                      </td>
                      <td role="cell" data-label="Situación" className="mobile-wide">
                        <p className="font-bold text-[var(--brand)]">{alert.situation}</p>
                        <p className="table-secondary">{alert.supportingDetail}</p>
                      </td>
                      <td role="cell" data-label="Estado" className="mobile-priority"><StatusBadge status={alert.status} /></td>
                      <td role="cell" data-label="Acción" className="mobile-actions text-right">
                        <Link href={alert.href} className="button-secondary button-sm">
                          Ver detalle
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
      </section>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <fieldset className="filter-group">
      <legend className="filter-legend">
        {label}
      </legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`filter-chip ${value === option.value ? "filter-chip-active" : ""}`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
