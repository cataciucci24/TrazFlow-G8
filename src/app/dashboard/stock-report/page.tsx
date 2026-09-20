import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StockReportForm } from "@/components/stock-reporting/stock-report-form";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getStockReportingData } from "@/lib/stock-reporting/queries";
import { EmptyState, PageHeader, SectionHeader, StatusBadge, TableShell } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Mi stock | TrazFlow" };

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export default async function StockReportPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "distributor_operator")) redirect("/dashboard");

  const data = await getStockReportingData(profile.id, profile.companyId);

  return (
    <div className="app-page">
      <PageHeader eyebrow="Inventario de distribución" title="Mi stock" description="Mantené actualizado el stock disponible y el consumo diario estimado de cada producto." />

      {!data.sourceAvailable ? (
        <div role="status" className="feedback feedback-warning">La carga de stock estará disponible cuando se aplique la migración correspondiente en Supabase.</div>
      ) : (
        <>
          {data.distributor ? (
            <StockReportForm products={data.products} />
          ) : (
            <div role="alert" className="feedback feedback-danger">Tu cuenta debe estar asociada a una única distribuidora para informar stock.</div>
          )}

          <section aria-labelledby="reported-stock-title" className="section-stack">
            <SectionHeader id="reported-stock-title" title="Información reportada" description="El mismo producto puede volver a guardarse para actualizar sus valores." />
            {data.entries.length === 0 ? (
              <div className="surface"><EmptyState title="Todavía no informaste stock" description="Los productos guardados aparecerán acá con su cobertura estimada." /></div>
            ) : (
              <TableShell label="Stock informado por producto">
                <table className="data-table min-w-[980px]">
                  <thead><tr><th scope="col">Producto</th><th scope="col">Distribuidora</th><th scope="col" className="text-right">Stock actual</th><th scope="col" className="text-right">Consumo diario</th><th scope="col" className="text-right">Días restantes</th><th scope="col">Alerta de stock</th><th scope="col">Actualizado</th></tr></thead>
                  <tbody className="divide-y divide-stone-200">{data.entries.map((entry) => {
                    const risk = entry.riskLevel === "critical"
                      ? { status: "critical" as const }
                      : entry.riskLevel === "caution"
                        ? { status: "caution" as const }
                        : null;
                    return <tr key={entry.id}><td><p className="font-medium">{entry.productName}</p><p className="table-secondary font-mono">{entry.productSku}</p></td><td>{entry.distributorName}</td><td className="text-right font-mono">{NUMBER_FORMATTER.format(entry.currentStock)}</td><td className="text-right font-mono">{NUMBER_FORMATTER.format(entry.dailyConsumption)}</td><td className="text-right font-mono font-semibold">{NUMBER_FORMATTER.format(entry.stockDays)}</td><td>{risk ? <StatusBadge status={risk.status} /> : <span className="status-badge bg-emerald-50 text-emerald-700">SIN ALERTA</span>}</td><td className="text-slate-500">{DATE_FORMATTER.format(new Date(entry.updatedAt))}</td></tr>;
                  })}</tbody>
                </table>
              </TableShell>
            )}
          </section>
        </>
      )}
    </div>
  );
}
