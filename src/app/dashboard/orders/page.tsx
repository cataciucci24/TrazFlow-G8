import type { Metadata } from "next";
import Link from "next/link";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, OrderStatusBadge, PageHeader, TableShell } from "@/components/ui/design-system";
import type { OrderStatus } from "@/lib/types";

export const metadata: Metadata = {
  title: "Órdenes de despacho | TrazFlow",
};

export default async function OrdersPage() {
  const profile = await requireUserProfile();
  const supabase = await createClient();

  const isLogisticsManager = hasRole(profile, "logistics_manager");

  const { data: orders, error } = await supabase
    .from("dispatch_orders")
    .select("id, status, estimated_dispatch_date, created_at, notes, distributors ( name )")
    .eq("company_id", profile.companyId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`No se pudieron cargar las órdenes: ${error.message}`);
  }

  return (
    <div className="app-page">
      <PageHeader
        title="Órdenes de despacho"
        description="Gestioná y consultá el estado de los envíos a cada distribuidora."
        action={isLogisticsManager ? (
          <Link
            href="/dashboard/orders/new"
            className="button-primary gap-2"
          >
            <span aria-hidden="true" className="text-lg leading-none">+</span>Nueva orden
          </Link>
        ) : undefined}
      />

      {!orders || orders.length === 0 ? <div className="surface"><EmptyState title="Todavía no hay órdenes"
        description="Los envíos registrados para tu empresa aparecerán acá."
        action={isLogisticsManager ? <Link href="/dashboard/orders/new" className="button-primary">Nueva orden</Link> : undefined}
      /></div> : <TableShell label="Órdenes de despacho registradas" mobileLayout="rows">
          <table role="table" aria-label="Órdenes de despacho registradas" className="data-table min-w-[780px]">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Código</th><th role="columnheader" scope="col">Distribuidora</th><th role="columnheader" scope="col">Fecha despacho</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Observaciones</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-stone-200">
              {orders.map((order) => {
                const distributor = Array.isArray(order.distributors)
                  ? order.distributors[0]
                  : order.distributors;

                return (
                  <tr role="row" key={order.id}>
                    <td role="cell" data-label="Código" className="mobile-primary font-mono font-bold text-slate-950">
                      <Link href={`/dashboard/orders/${order.id}`} title={order.id} className="button-secondary">{order.id.slice(0, 8).toUpperCase()}</Link>
                    </td>
                    <td role="cell" data-label="Distribuidora" className="font-medium text-slate-950">
                      {distributor?.name ?? "—"}
                    </td>
                    <td role="cell" data-label="Fecha despacho" className="mobile-priority text-slate-600">
                      {order.estimated_dispatch_date ? new Date(`${order.estimated_dispatch_date}T00:00:00`).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td role="cell" data-label="Estado" className="mobile-priority">
                      <OrderStatusBadge status={order.status as OrderStatus} />
                    </td>
                    <td role="cell" data-label="Observaciones" className="mobile-wide max-w-72 text-slate-500">
                      {order.notes ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </TableShell>}
    </div>
  );
}
