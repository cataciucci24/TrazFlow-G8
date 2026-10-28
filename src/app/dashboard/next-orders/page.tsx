import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCustomerOrderForecasts } from "@/lib/order-forecast/queries";
import { CustomerForecasts } from "@/components/order-forecast/customer-forecasts";
import { PageHeader, SummaryCard } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Próximos pedidos | TrazFlow" };

export default async function NextOrdersPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const { forecasts, calculatedAt } = await getCustomerOrderForecasts();
  return <div className="app-page">
    <PageHeader eyebrow="Planificación logística" title="Próximos pedidos" description="Anticipá cuándo podría volver a pedir cada cliente según sus despachos confirmados." />
    <section aria-label="Resumen de estimaciones" className="grid gap-4 sm:grid-cols-3">
      <SummaryCard label="CON ESTIMACIÓN" value={forecasts.filter((item) => item.estimatedDate).length} />
      <SummaryCard label="FECHA ESTIMADA SUPERADA" value={forecasts.filter((item) => item.overdueDays > 0).length} />
      <SummaryCard label="HISTORIAL INSUFICIENTE" value={forecasts.filter((item) => !item.estimatedDate).length} />
    </section>
    <details className="surface p-4 text-sm text-stone-600">
      <summary className="cursor-pointer font-medium text-stone-900">Cómo calculamos las fechas</summary>
      <div className="mt-3 space-y-2">
        <p>Usamos la fecha real de confirmación de todos los despachos del cliente, incluidos los ya entregados. Sumamos al último despacho el intervalo promedio entre despachos.</p>
        <p>El rango se amplía según la variación de esos intervalos (promedio ± un desvío estándar). Es orientativo: no garantiza una fecha ni crea órdenes automáticamente.</p>
        <p>Los días se calculan en horario argentino. Si hubo varios despachos el mismo día, estimamos como mínimo un día después del último. Las cantidades se promedian por pedido que contiene el producto, sumando sus pallets.</p>
      </div>
    </details>
    <CustomerForecasts forecasts={forecasts} />
    <p className="text-xs text-stone-500">Calculado al abrir la pantalla: {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(calculatedAt))}.</p>
  </div>;
}
