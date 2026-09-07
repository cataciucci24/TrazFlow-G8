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
    .select("id, status, estimated_dispatch_date, created_at, distributors ( name )")
    .eq("company_id", profile.companyId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`No se pudieron cargar las órdenes: ${error.message}`);
  }

  return (
    <div className="space-y-8">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/20 blur-3xl pointer-events-none" />
      <div className="absolute -right-32 top-1/2 h-96 w-96 rounded-full bg-red-950/15 blur-3xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Órdenes de Despacho
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Listado general de órdenes registradas para tu empresa.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isLogisticsManager && (
            <Link
              href="/dashboard/orders/new"
              className="rounded-xl bg-[#3d0c11] px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#2b080c]"
            >
              + Nueva orden
            </Link>
          )}
          <Link
            href="/dashboard"
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white shadow-sm"
          >
            Volver
          </Link>
        </div>
      </div>

      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 backdrop-blur-md shadow-xl">
        {!orders || orders.length === 0 ? (
          <p className="text-sm text-zinc-400 py-8 text-center">
            No hay órdenes de despacho registradas en el sistema.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-3 font-medium">ID / Referencia</th>
                  <th className="py-3 font-medium">Distribuidor</th>
                  <th className="py-3 font-medium">Estado</th>
                  <th className="py-3 font-medium">Fecha estimada</th>
                  <th className="py-3 font-medium text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {orders.map((order) => {
                  const distributor = Array.isArray(order.distributors)
                    ? order.distributors[0]
                    : order.distributors;

                  return (
                    <tr key={order.id} className="transition-colors hover:bg-zinc-800/40">
                      <td className="py-4 font-mono text-zinc-200">
                        {order.id.slice(0, 8)}...
                      </td>
                      <td className="py-4 text-zinc-200 font-medium">
                        {distributor?.name ?? "—"}
                      </td>
                      <td className="py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md ${
                          order.status === "confirmed" 
                            ? "bg-emerald-950/60 border-emerald-900/40 text-emerald-300" 
                            : "bg-red-950/60 border-red-900/40 text-red-300"
                        }`}>
                          {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}
                        </span>
                      </td>
                      <td className="py-4 text-zinc-300">
                        {order.estimated_dispatch_date ?? "—"}
                      </td>
                      <td className="py-4 text-right">
                        <Link
                          href={`/dashboard/orders/${order.id}`}
                          className="inline-flex items-center text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                        >
                          Ver detalle &rarr;
                        </Link>
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
