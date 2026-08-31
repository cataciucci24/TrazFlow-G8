import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getDispatchOrderDetail } from "@/lib/orders/queries";
import { getAvailablePallets, getPalletsForOrder } from "@/lib/pallets/queries";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import { AssociatePalletsForm } from "@/components/orders/associate-pallets-form";

export const metadata: Metadata = {
  title: "Detalle de orden | TrazFlow",
};

export default async function DispatchOrderDetailPage({
  params,
}: PageProps<"/dashboard/orders/[id]">) {
  const profile = await requireUserProfile();

  // Mismo criterio que en la creación de órdenes: solo el responsable
  // logístico opera esta pantalla.
  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const order = await getDispatchOrderDetail(id);

  // RLS ya filtra por empresa; si no vino nada, o no existe o es de otra empresa.
  if (!order) notFound();

  const [associatedPallets, availablePallets] = await Promise.all([
    getPalletsForOrder(id),
    order.status === "draft" ? getAvailablePallets(profile.companyId) : Promise.resolve([]),
  ]);

  const canAssociate = order.status === "draft";

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          Orden de despacho
        </h1>
        <p className="text-sm text-gray-500">{order.id}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-6 text-sm">
        <div>
          <p className="text-gray-500">Distribuidor de destino</p>
          <p className="font-medium text-gray-900">{order.distributorName}</p>
        </div>
        <div>
          <p className="text-gray-500">Estado</p>
          <p className="font-medium text-gray-900">
            {ORDER_STATUS_LABELS[order.status]}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Fecha estimada de despacho</p>
          <p className="font-medium text-gray-900">
            {order.estimatedDispatchDate}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Creada el</p>
          <p className="font-medium text-gray-900">
            {new Date(order.createdAt).toLocaleDateString("es-AR")}
          </p>
        </div>
        {order.notes && (
          <div className="col-span-2">
            <p className="text-gray-500">Observaciones</p>
            <p className="font-medium text-gray-900">{order.notes}</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-medium text-gray-700">
          Pallets asociados
        </h2>

        {associatedPallets.length === 0 ? (
          <p className="text-sm text-gray-500">
            Todavía no hay pallets asociados a esta orden.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 font-medium">QR</th>
                <th className="py-2 font-medium">Producto</th>
                <th className="py-2 font-medium">Lote</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {associatedPallets.map((pallet) => (
                <tr key={pallet.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-900">{pallet.qrCode}</td>
                  <td className="py-2 text-gray-900">
                    {pallet.productName} ({pallet.productSku})
                  </td>
                  <td className="py-2 text-gray-900">{pallet.batchNumber}</td>
                  <td className="py-2 text-gray-900">
                    {PALLET_STATUS_LABELS[pallet.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canAssociate ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-gray-700">
            Asociar pallets disponibles
          </h2>

          {availablePallets.length === 0 ? (
            <p className="text-sm text-gray-500">
              No hay pallets en depósito disponibles para asociar.
            </p>
          ) : (
            <AssociatePalletsForm orderId={order.id} pallets={availablePallets} />
          )}
        </div>
      ) : (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
          Esta orden ya no admite asociar pallets (estado:{" "}
          {ORDER_STATUS_LABELS[order.status]}).
        </p>
      )}
    </section>
  );
}
