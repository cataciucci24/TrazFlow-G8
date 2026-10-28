import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getExpirationAlerts } from "@/lib/pallets/queries";
import { getDistributorStockAlerts } from "@/lib/stock-alerts/queries";
import { EmptyState, OperationCard, OperationProgress, OrderStatusBadge, PageHeader, SectionHeader } from "@/components/ui/design-system";
import type { OrderStatus } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogisticsOverview } from "@/components/dashboard/logistics-overview";
import { CreatedOrderNotice } from "@/components/ui/feedback";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const { created } = await searchParams;
  const profile = await requireUserProfile();

  if (hasRole(profile, "driver_operator")) redirect("/dashboard/deliveries");

  if (hasRole(profile, "warehouse_operator")) {
    const supabase = await createClient();
    let query = supabase.from("dispatch_orders").select("id, status, distributors ( name ), order_pallets ( validated_at )").order("created_at", { ascending: true });
    query = query.eq("company_id", profile.companyId).in("status", ["draft", "validating", "has_discrepancy"]);
    const { data: orders } = await query;

    const heading = "Confirmar despacho";
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
                    className="surface operation-card"
                  >
                    <OperationCard code={order.id.slice(0, 8).toUpperCase()} title={distributor?.name ?? "Distribuidor sin nombre"}
                      status={<OrderStatusBadge status={order.status as OrderStatus} />}>
                      <OperationProgress completed={validated} total={pallets.length} label="pallets confirmados" />
                    </OperationCard>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="surface"><EmptyState title="No hay órdenes pendientes" description="Cuando haya una orden lista para operar, aparecerá acá." /></div>
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

  if (alertData) {
    return (
      <div className="app-page">
        <PageHeader title="Centro de control" description="Priorizá los riesgos de stock y vencimiento, y continuá la operación desde un mismo lugar." />
        {created === "1" && <CreatedOrderNotice />}
        <LogisticsOverview expirationAlerts={alertData[0]} stockData={alertData[1]} />
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader title="Panel de control" description="Una vista general de las operaciones que requieren tu atención." />

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
