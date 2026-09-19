import type { DistributorStockAlert } from "@/lib/types";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

type StockAlertsProps = {
  alerts: DistributorStockAlert[];
  inventorySourceAvailable: boolean;
};

export function StockAlerts({ alerts, inventorySourceAvailable }: StockAlertsProps) {
  const criticalAlerts = alerts.filter((alert) => alert.riskLevel === "critical").length;

  return (
    <section aria-labelledby="stock-alerts-title" className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 bg-stone-50/70 px-5 py-4">
        <div>
          <h2 id="stock-alerts-title" className="text-xl font-bold">Alertas de stock</h2>
          <p className="mt-1 text-sm text-stone-500">Días de stock = stock actual / consumo diario. Se informa riesgo hasta 14 días.</p>
        </div>
        {alerts.length > 0 && <div className="flex items-center gap-2 text-xs font-bold"><span className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">{criticalAlerts} críticas</span><span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">{alerts.length - criticalAlerts} en precaución</span></div>}
      </div>

      {!inventorySourceAvailable ? (
        <div role="status" className="px-5 py-12 text-center">
          <p className="font-semibold text-slate-950">Las alertas de stock todavía no están disponibles</p>
          <p className="mt-1 text-sm text-stone-500">Aplicá la migración de inventario en Supabase para comenzar a calcular la cobertura por distribuidora.</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="font-semibold text-slate-950">No hay alertas de stock activas</p>
          <p className="mt-1 text-sm text-stone-500">Los productos con más de 14 días de cobertura no requieren seguimiento.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Alertas de riesgo de quiebre de stock</caption>
            <thead className="bg-stone-100/80 text-stone-500"><tr><th scope="col" className="px-5 py-4 font-semibold">Distribuidora</th><th scope="col" className="px-5 py-4 font-semibold">Producto</th><th scope="col" className="px-5 py-4 text-right font-semibold">Stock actual</th><th scope="col" className="px-5 py-4 text-right font-semibold">Consumo diario</th><th scope="col" className="px-5 py-4 text-right font-semibold">Días restantes</th><th scope="col" className="px-5 py-4 font-semibold">Riesgo</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {alerts.map((alert) => {
                const isCritical = alert.riskLevel === "critical";
                return <tr key={alert.id} className={isCritical ? "bg-red-50/30" : "transition-colors hover:bg-amber-50/40"}><td className="px-5 py-4 font-medium text-slate-950">{alert.distributorName}</td><td className="px-5 py-4"><p className="font-medium text-slate-950">{alert.productName}</p><p className="mt-0.5 font-mono text-xs text-stone-500">{alert.productSku}</p></td><td className="px-5 py-4 text-right font-mono text-slate-950">{NUMBER_FORMATTER.format(alert.currentStock)}</td><td className="px-5 py-4 text-right font-mono text-slate-950">{NUMBER_FORMATTER.format(alert.dailyConsumption)}</td><td className="px-5 py-4 text-right"><span className="font-mono font-bold text-slate-950">{NUMBER_FORMATTER.format(alert.stockDays)}</span><span className="ml-1 text-xs text-stone-500">días</span></td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${isCritical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{isCritical ? "CRÍTICA" : "PRECAUCIÓN"}</span></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
