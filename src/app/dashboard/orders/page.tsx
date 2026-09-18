import type { Metadata } from "next";
import Link from "next/link";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";

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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Órdenes de despacho</h1>
        {isLogisticsManager && (
          <Link
            href="/dashboard/orders/new"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600"
          >
            <span className="text-xl leading-none">＋</span>Nueva orden
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        {!orders || orders.length === 0 ? (
          <p className="py-12 text-center text-sm text-stone-500">
            No hay órdenes de despacho registradas en el sistema.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr className="bg-stone-100/80 text-stone-500">
                  <th className="px-5 py-4 font-semibold">Código</th>
                  <th className="px-5 py-4 font-semibold">Distribuidora</th>
                  <th className="px-5 py-4 font-semibold">Fecha despacho</th>
                  <th className="px-5 py-4 font-semibold">Estado</th>
                  <th className="px-5 py-4 font-semibold">Observaciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {orders.map((order) => {
                  const distributor = Array.isArray(order.distributors)
                    ? order.distributors[0]
                    : order.distributors;

                  return (
                    <tr key={order.id} className="transition-colors hover:bg-amber-50/40">
                      <td className="px-5 py-4 font-mono font-bold text-slate-950">
                        <Link href={`/dashboard/orders/${order.id}`} className="hover:text-amber-600">{order.id.slice(0, 8).toUpperCase()}</Link>
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-950">
                        {distributor?.name ?? "—"}
                      </td>
                      <td className="px-5 py-4 text-stone-600">
                        {order.estimated_dispatch_date ? new Date(`${order.estimated_dispatch_date}T00:00:00`).toLocaleDateString("es-AR") : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                          order.status === "confirmed" 
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-amber-50 text-amber-600"
                        }`}>
                          {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}
                        </span>
                      </td>
                      <td className="max-w-72 truncate px-5 py-4 text-stone-500">
                        {order.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
