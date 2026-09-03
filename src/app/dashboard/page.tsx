import type { Metadata } from "next";
import Link from "next/link";

import { getUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import type { DispatchOrder } from "@/lib/types";

export const metadata: Metadata = {
  title: "Dashboard | TrazFlow",
};

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  // El layout ya garantizó que hay perfil; acá lo leemos del cache del request.
  const profile = await getUserProfile();
  if (!profile) return null;

  const { created } = await searchParams;

  // Ejemplo de gating por rol: solo el responsable de logística crea órdenes.
  const canCreateDispatchOrders = hasRole(profile, "logistics_manager");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select("id, status, estimated_dispatch_date, notes, created_at, distributors ( name )")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(
      `No se pudieron leer las órdenes de despacho (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  const orders: DispatchOrder[] = (data ?? []).map((row) => {
    const distributor = Array.isArray(row.distributors)
      ? row.distributors[0]
      : row.distributors;

    return {
      id: row.id,
      distributorId: "",
      distributorName: distributor?.name ?? "—",
      status: row.status,
      estimatedDispatchDate: row.estimated_dispatch_date,
      notes: row.notes,
      createdAt: row.created_at,
    };
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          Hola, {profile.name}
        </h1>

        {canCreateDispatchOrders && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link
              href="/dashboard/traceability"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              Consultar trazabilidad
            </Link>
            <Link
              href="/dashboard/orders/new"
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
            >
              Crear orden de despacho
            </Link>
          </div>
        )}
      </div>

      {created === "1" && (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          Orden de despacho creada correctamente.
        </p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-medium text-gray-700">
          Órdenes de despacho de tu empresa
        </h2>

        {orders.length === 0 ? (
          <p className="text-sm text-gray-500">
            Todavía no hay órdenes de despacho creadas.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 font-medium">Distribuidor</th>
                <th className="py-2 font-medium">Fecha estimada</th>
                <th className="py-2 font-medium">Estado</th>
                <th className="py-2 font-medium">Creada el</th>
                <th className="py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-900">{order.distributorName}</td>
                  <td className="py-2 text-gray-900">
                    {order.estimatedDispatchDate}
                  </td>
                  <td className="py-2 text-gray-900">
                    {ORDER_STATUS_LABELS[order.status]}
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(order.createdAt).toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="text-sm font-medium text-gray-900 underline hover:text-gray-700"
                    >
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
