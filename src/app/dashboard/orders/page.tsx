import type { Metadata } from "next";
import Link from "next/link";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { OrderStatusBadge, PageHeader, TableShell } from "@/components/ui/design-system";
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

      <TableShell label="Órdenes de despacho registradas">
        {!orders || orders.length === 0 ? (
          <p className="py-12 text-center text-sm text-stone-500">
            No hay órdenes de despacho registradas en el sistema.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[780px]">
              <thead>
                <tr>
                  <th>Código</th><th>Distribuidora</th><th>Fecha despacho</th><th>Estado</th><th>Observaciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {orders.map((order) => {
                  const distributor = Array.isArray(order.distributors)
                    ? order.distributors[0]
                    : order.distributors;

                  return (
                    <tr key={order.id}>
                      <td className="font-mono font-bold text-slate-950">
                        <Link href={`/dashboard/orders/${order.id}`} className="table-action">{order.id.slice(0, 8).toUpperCase()}</Link>
                      </td>
                      <td className="font-medium text-slate-950">
                        {distributor?.name ?? "—"}
                      </td>
                      <td className="text-slate-600">
                        {order.estimated_dispatch_date ? new Date(`${order.estimated_dispatch_date}T00:00:00`).toLocaleDateString("es-AR") : "—"}
                      </td>
                      <td>
                        <OrderStatusBadge status={order.status as OrderStatus} />
                      </td>
                      <td className="max-w-72 truncate text-slate-500">
                        {order.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableShell>
    </div>
  );
}
