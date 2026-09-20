import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getExpirationAlerts } from "@/lib/pallets/queries";
import { getDistributorStockAlerts } from "@/lib/stock-alerts/queries";
import { OrderStatusBadge, PageHeader, SectionHeader, SummaryCard } from "@/components/ui/design-system";
import type { OrderStatus } from "@/lib/types";
import Link from "next/link";

export default async function DashboardPage() {
  const profile = await requireUserProfile();

  if (hasRole(profile, "warehouse_operator", "distributor_operator")) {
    const supabase = await createClient();
    let query = supabase.from("dispatch_orders").select("id, status, distributors ( name ), order_pallets ( validated_at )").order("created_at", { ascending: true });
    query = hasRole(profile, "warehouse_operator")
      ? query.eq("company_id", profile.companyId).in("status", ["draft", "validating", "has_discrepancy"])
      : query.eq("status", "confirmed");
    const { data: orders } = await query;

    const heading = hasRole(profile, "warehouse_operator") ? "Confirmar despacho" : "Confirmar recepción";
    const assignedOrders = (orders ?? []).filter((order) => (order.order_pallets ?? []).length > 0);
    return (
      <div className="app-page">
        <PageHeader title={heading} description="Seleccioná una orden para validar los pallets mediante cámara o ingresando su código." />
        {assignedOrders.length > 0 ? (
          <section className="section-stack">
            <SectionHeader title="Estado de órdenes" description="Órdenes asignadas que requieren validación operativa." />
            <div className="grid gap-4 lg:grid-cols-2">
              {assignedOrders.map((order) => {
                const distributor = Array.isArray(order.distributors) ? order.distributors[0] : order.distributors;
                const pallets = order.order_pallets ?? [];
                const validated = pallets.filter((pallet) => pallet.validated_at).length;
                return (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="surface p-5 transition hover:border-[var(--brand-border)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono font-bold">{order.id.slice(0, 8).toUpperCase()}</p>
                        <p className="mt-1 text-sm text-stone-500">{distributor?.name ?? "Distribuidor sin nombre"}</p>
                      </div>
                      <OrderStatusBadge status={order.status as OrderStatus} />
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${pallets.length ? (validated / pallets.length) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-sm text-stone-500">
                      {validated} de {pallets.length} pallets confirmados
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="surface p-8 text-center">
            <h2 className="text-xl font-bold">No hay órdenes pendientes</h2>
            <p className="mt-2 text-sm text-stone-500">Cuando haya una orden lista para operar, aparecerá acá.</p>
          </div>
        )}
      </div>
    );
  }

  const alertData = hasRole(profile, "logistics_manager")
    ? await Promise.all([
        getExpirationAlerts(profile.companyId),
        getDistributorStockAlerts(profile.companyId),
      ])
    : null;

  const alertCounts = alertData
    ? {
        critical: alertData[0].filter((alert) => alert.urgency === "critical").length + alertData[1].alerts.filter((alert) => alert.riskLevel === "critical").length,
        caution: alertData[0].filter((alert) => alert.urgency === "warning").length + alertData[1].alerts.filter((alert) => alert.riskLevel === "caution").length,
        upcoming: alertData[0].filter((alert) => alert.urgency === "upcoming").length,
      }
    : null;

  return (
    <div className="app-page">
      <PageHeader title="Panel de control" description="Una vista general de las operaciones que requieren tu atención." />

      {alertCounts && (
        <section aria-labelledby="dashboard-alerts-title" className="section-stack">
          <SectionHeader
            id="dashboard-alerts-title"
            title="Alertas"
            description="Resumen consolidado de situaciones de stock y vencimiento."
            action={<Link href="/dashboard/alerts" className="button-primary">Ver alertas</Link>}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="CRÍTICO" value={alertCounts.critical} detail={alertCounts.critical === 1 ? "alerta" : "alertas"} tone="critical" />
            <SummaryCard label="PRECAUCIÓN" value={alertCounts.caution} detail={alertCounts.caution === 1 ? "alerta" : "alertas"} tone="caution" />
            <SummaryCard label="PRÓXIMO" value={alertCounts.upcoming} detail={alertCounts.upcoming === 1 ? "alerta" : "alertas"} tone="upcoming" />
          </div>
        </section>
      )}

      <section className="section-stack" aria-labelledby="quick-access-title">
        <SectionHeader id="quick-access-title" title="Accesos rápidos" description="Ingresá a las áreas principales de la operación logística." />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface group p-6 transition-colors hover:border-[var(--brand-border)]">
            <h3 className="text-lg font-semibold">Órdenes de despacho</h3>
            <p className="mt-2 text-sm text-slate-600">
              Gestioná, asociá pallets y confirmá los despachos de mercadería de forma rápida y ordenada.
            </p>
            <div className="mt-6">
              <Link href="/dashboard/orders" className="table-action">Ver órdenes →</Link>
            </div>
          </div>

          <div className="surface group p-6 transition-colors hover:border-[var(--brand-border)]">
            <h3 className="text-lg font-semibold">Seguimiento de pallets</h3>
            <p className="mt-2 text-sm text-slate-600">
              Buscá y escaneá pallets por su código QR para consultar todo su historial de movimientos.
            </p>
            <div className="mt-6">
              <Link href="/dashboard/traceability" className="table-action">Ir al seguimiento →</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
