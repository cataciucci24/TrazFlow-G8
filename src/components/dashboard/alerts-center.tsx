"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  AlertTypeBadge,
  EmptyState,
  SectionHeader,
  StatusBadge,
  SummaryCard,
  TableShell,
  type AlertStatus,
  type AlertType,
} from "@/components/ui/design-system";
import type { DistributorStockAlert, ExpirationAlert } from "@/lib/types";

type UnifiedAlert = {
  id: string;
  type: AlertType;
  status: AlertStatus;
  productName: string;
  productSku: string;
  batchNumber?: string;
  location: string;
  situation: string;
  supportingDetail: string;
  href: string;
};

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

function pluralizeAlert(count: number) {
  return `${count} ${count === 1 ? "alerta" : "alertas"}`;
}

function unifyAlerts(expirationAlerts: ExpirationAlert[], stockAlerts: DistributorStockAlert[]): UnifiedAlert[] {
  const expirations: UnifiedAlert[] = expirationAlerts.map((alert) => ({
    id: `expiration-${alert.palletId}`,
    type: "expiration",
    status: alert.urgency === "warning" ? "caution" : alert.urgency,
    productName: alert.productName,
    productSku: alert.productSku,
    batchNumber: alert.batchNumber,
    location: alert.currentLocation ?? "Sin ubicación registrada",
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
}: {
  expirationAlerts: ExpirationAlert[];
  stockAlerts: DistributorStockAlert[];
  inventorySourceAvailable: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<"all" | AlertType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AlertStatus>("all");
  const alerts = useMemo(() => unifyAlerts(expirationAlerts, stockAlerts), [expirationAlerts, stockAlerts]);
  const filteredAlerts = alerts.filter((alert) =>
    (typeFilter === "all" || alert.type === typeFilter) &&
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
          description="Totales consolidados de stock y vencimientos según su prioridad."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {(["critical", "caution", "upcoming"] as const).map((status) => (
            <SummaryCard
              key={status}
              label={status === "critical" ? "CRÍTICO" : status === "caution" ? "PRECAUCIÓN" : "PRÓXIMO"}
              value={counts[status]}
              detail={counts[status] === 1 ? "alerta" : "alertas"}
              tone={status}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="active-alerts-title" className="section-stack">
        <SectionHeader
          id="active-alerts-title"
          title="Alertas activas"
          description="Situaciones detectadas que requieren seguimiento."
          action={<p className="text-sm text-slate-500">{pluralizeAlert(filteredAlerts.length)}</p>}
        />

        <div className="surface flex flex-col gap-4 p-4 sm:p-5">
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
              label="Estado"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "Todos" },
                { value: "critical", label: "CRÍTICO" },
                { value: "caution", label: "PRECAUCIÓN" },
                { value: "upcoming", label: "PRÓXIMO" },
              ]}
            />
          </div>

          {!inventorySourceAvailable ? (
            <p role="status" className="feedback feedback-warning">
              Las alertas de stock estarán disponibles cuando se aplique la migración de inventario en Supabase. Las alertas de vencimiento siguen visibles.
            </p>
          ) : null}

          {filteredAlerts.length === 0 ? (
            <EmptyState title="No hay alertas para estos filtros" description="Probá con otro tipo o estado para consultar las situaciones activas." />
          ) : (
            <TableShell label="Listado unificado de alertas activas">
              <table className="data-table min-w-[960px]">
                <caption className="sr-only">Alertas activas de stock y vencimiento</caption>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Producto</th>
                    <th scope="col">Ubicación</th>
                    <th scope="col">Situación</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAlerts.map((alert) => (
                    <tr key={alert.id} className={`alert-row-${alert.status}`}>
                      <td><AlertTypeBadge type={alert.type} /></td>
                      <td>
                        <p className="font-semibold text-slate-950">{alert.productName}</p>
                        <p className="table-secondary font-mono">
                          {alert.productSku}{alert.batchNumber ? ` · Lote ${alert.batchNumber}` : ""}
                        </p>
                      </td>
                      <td className="max-w-56 text-slate-600">{alert.location}</td>
                      <td>
                        <p className="font-semibold text-slate-900">{alert.situation}</p>
                        <p className="table-secondary">{alert.supportingDetail}</p>
                      </td>
                      <td><StatusBadge status={alert.status} /></td>
                      <td className="text-right">
                        <Link href={alert.href} className="table-action">
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
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="mr-1 text-xs font-bold uppercase tracking-wider text-slate-500 sm:float-left sm:py-2">
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
