import { Badge, EmptyState } from "@/components/ui/design-system";
import type { CustomerForecast } from "@/lib/order-forecast/forecast";

const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
function formatDate(value: string) { return date.format(new Date(`${value}T00:00:00Z`)); }

export function CustomerForecasts({ forecasts }: { forecasts: CustomerForecast[] }) {
  if (!forecasts.length) return <EmptyState title="Todavía no hay clientes" description="Los destinatarios de tu empresa aparecerán acá cuando estén registrados." />;
  return <ol className="space-y-4" aria-label="Clientes ordenados por próxima orden">
    {forecasts.map((forecast) => <li key={forecast.customerId} className="surface min-w-0 space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{forecast.customerName}</h2>
          <p className="mt-1 text-sm text-stone-500">{forecast.dispatchCount} despachos confirmados{forecast.lastDispatchDate ? ` · Último: ${formatDate(forecast.lastDispatchDate)}` : ""}</p>
        </div>
        <Badge tone={!forecast.estimatedDate ? "neutral" : forecast.overdueDays > 0 ? "warning" : "info"}>
          {!forecast.estimatedDate ? "Historial insuficiente" : forecast.overdueDays > 0 ? "Fecha estimada superada" : "Próximo pedido estimado"}
        </Badge>
      </div>
      {forecast.estimatedDate && forecast.rangeStart && forecast.rangeEnd ? <div className="grid gap-3 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-3">
        <div><p className="text-stone-500">Fecha estimada</p><p className="mt-1 text-lg font-bold">{formatDate(forecast.estimatedDate)}</p></div>
        <div><p className="text-stone-500">Rango orientativo</p><p className="mt-1 font-medium">{formatDate(forecast.rangeStart)} – {formatDate(forecast.rangeEnd)}</p></div>
        <div><p className="text-stone-500">Frecuencia promedio</p><p className="mt-1 font-medium">{forecast.averageIntervalDays === 0 ? "Despachos en el mismo día" : `Cada ${number.format(forecast.averageIntervalDays!)} días`}</p>
          {forecast.overdueDays > 0 && <p className="mt-1 text-amber-800">La fecha estimada pasó hace {forecast.overdueDays} {forecast.overdueDays === 1 ? "día" : "días"}.</p>}
        </div>
      </div> : <p className="text-sm text-stone-600">Se necesitan al menos 3 despachos confirmados para calcular una fecha.</p>}
      <div><h3 className="text-sm font-semibold">Productos más habituales</h3>
        {!forecast.products.length ? <p className="mt-2 text-sm text-stone-500">Sin productos despachados registrados.</p> : <ul className="mt-2 grid gap-3 sm:grid-cols-3">
          {forecast.products.map((product) => <li key={product.id} className="min-w-0 rounded-xl border border-stone-200 p-3 text-sm">
            <p className="break-words font-medium">{product.name}</p><p className="break-all text-xs text-stone-500">{product.sku}</p>
            <p className="mt-2">En {product.orderCount} de {forecast.dispatchCount} despachos</p>
            <p className="mt-1 font-medium">{product.averageQuantity === null ? "Sin cantidad completa registrada" : `${number.format(product.averageQuantity)} ${product.unit} por pedido con este producto`}</p>
            {product.measuredOrderCount < product.orderCount && product.measuredOrderCount > 0 && <p className="mt-1 text-xs text-stone-500">Promedio sobre {product.measuredOrderCount} pedidos con cantidad completa.</p>}
          </li>)}
        </ul>}
      </div>
    </li>)}
  </ol>;
}
