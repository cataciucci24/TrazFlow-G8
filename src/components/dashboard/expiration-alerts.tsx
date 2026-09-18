import Link from "next/link";

import type { ExpirationAlert } from "@/lib/types";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" });
const QUANTITY_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 20 });

const urgencyDetails = {
  critical: { label: "Crítico", className: "bg-red-50 text-red-700" },
  warning: { label: "Advertencia", className: "bg-amber-50 text-amber-700" },
  upcoming: { label: "Próximo", className: "bg-sky-50 text-sky-700" },
} as const;

export function ExpirationAlertSummary({ alerts }: { alerts: ExpirationAlert[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {(Object.keys(urgencyDetails) as ExpirationAlert["urgency"][]).map((urgency) => {
        const detail = urgencyDetails[urgency];
        const count = alerts.filter((alert) => alert.urgency === urgency).length;
        return (
          <div key={urgency} className="rounded-2xl border border-stone-200 bg-white p-5">
            <dt><span className={`inline-block rounded-full px-3 py-1.5 text-xs font-bold ${detail.className}`}>{detail.label}</span></dt>
            <dd className="mt-3 text-2xl font-bold tabular-nums">{count}</dd>
            <p className="mt-1 text-sm text-stone-500">{count === 1 ? "alerta" : "alertas"}</p>
          </div>
        );
      })}
    </dl>
  );
}

export function ExpirationAlerts({ alerts }: { alerts: ExpirationAlert[] }) {
  return (
    <section aria-labelledby="expiration-alerts-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="expiration-alerts-title" className="text-xl font-bold">Alertas de vencimiento</h2>
          <p className="mt-1 text-sm text-stone-500">Mercadería disponible que vence dentro de los próximos 90 días.</p>
        </div>
        <p className="text-sm text-stone-500">{alerts.length} {alerts.length === 1 ? "alerta" : "alertas"}</p>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <h3 className="text-lg font-bold">No hay vencimientos próximos</h3>
          <p className="mt-2 text-sm text-stone-500">No hay mercadería disponible con vencimiento dentro de los próximos 90 días.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">Alertas de mercadería próxima a vencer</caption>
            <thead className="bg-stone-100/80 text-stone-500">
              <tr>
                {['Producto', 'Lote', 'Cantidad disponible', 'Ubicación actual', 'Vencimiento', 'Días restantes', 'Urgencia', ''].map((heading) => (
                  <th key={heading || 'actions'} scope="col" className="px-5 py-4 font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {alerts.map((alert) => {
                const urgency = urgencyDetails[alert.urgency];
                return (
                  <tr key={alert.palletId} className="transition-colors hover:bg-amber-50/40">
                    <td className="max-w-64 break-words px-5 py-4"><p className="font-medium">{alert.productName}</p><p className="mt-1 font-mono text-xs text-stone-500">{alert.productSku}</p></td>
                    <td className="max-w-48 break-words px-5 py-4 font-mono text-stone-600">{alert.batchNumber}</td>
                    <td className="px-5 py-4 tabular-nums">{QUANTITY_FORMATTER.format(alert.quantity)} {alert.unitOfMeasure}</td>
                    <td className="max-w-64 break-words px-5 py-4 text-stone-500">{alert.currentLocation ?? "Sin ubicación registrada"}</td>
                    <td className="px-5 py-4 text-stone-600">{DATE_FORMATTER.format(new Date(`${alert.expirationDate}T00:00:00Z`))}</td>
                    <td className="px-5 py-4 tabular-nums font-semibold">{alert.daysRemaining}</td>
                    <td className="px-5 py-4"><span className={`inline-block rounded-full px-3 py-1.5 text-xs font-bold ${urgency.className}`}>{urgency.label}</span></td>
                    <td className="px-5 py-4 text-right"><Link href={`/dashboard/traceability?view=lotes&lote=${encodeURIComponent(alert.batchNumber)}`} className="whitespace-nowrap text-sm font-bold text-amber-600 hover:text-amber-700">Ver detalle</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
