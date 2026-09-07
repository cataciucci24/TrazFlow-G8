import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getDispatchOrderDetail } from "@/lib/orders/queries";
import { getAvailablePallets, getPalletsForOrder } from "@/lib/pallets/queries";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import { AssociatePalletsForm } from "@/components/orders/associate-pallets-form";
import { ConfirmDispatchButton } from "@/components/orders/confirm-dispatch-button";
import { DissociatePalletButton } from "@/components/orders/dissociate-pallet-button";
import { PalletValidationPanel } from "@/components/pallet-validation/pallet-validation-panel";
import { PalletReceptionPanel } from "@/components/pallet-reception/pallet-reception-panel";
import {
  getOrderDispatchDiscrepancies,
  getOrderPalletValidations,
} from "@/lib/pallet-validation/queries";
import { getOrderPalletReceptions } from "@/lib/pallet-reception/queries";

export const metadata: Metadata = {
  title: "Detalle de orden | TrazFlow",
};

export default async function DispatchOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireUserProfile();

  const isLogisticsManager = hasRole(profile, "logistics_manager");
  const isWarehouseOperator = hasRole(profile, "warehouse_operator");
  const isDistributorOperator = hasRole(profile, "distributor_operator");

  if (!isLogisticsManager && !isWarehouseOperator && !isDistributorOperator) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const order = await getDispatchOrderDetail(id);

  if (!order) notFound();

  const canAssociate = isLogisticsManager && order.status === "draft";
  const needsPalletValidations = isWarehouseOperator || canAssociate;

  const [
    associatedPallets,
    availablePallets,
    palletValidations,
    dispatchDiscrepancies,
    palletReceptions,
  ] = await Promise.all([
    getPalletsForOrder(id),
    canAssociate ? getAvailablePallets(profile.companyId) : Promise.resolve([]),
    needsPalletValidations ? getOrderPalletValidations(id) : Promise.resolve([]),
    isWarehouseOperator
      ? getOrderDispatchDiscrepancies(id)
      : Promise.resolve([]),
    isDistributorOperator
      ? getOrderPalletReceptions(id)
      : Promise.resolve([]),
  ]);

  const validatedAtByPalletId = new Map(
    palletValidations.map((pallet) => [pallet.id, pallet.validatedAt]),
  );

  const missingPalletsCount = palletValidations.filter(
    (pallet) => !pallet.validatedAt,
  ).length;
  const canConfirm =
    isWarehouseOperator &&
    order.status === "draft" &&
    palletValidations.length > 0;

  return (
    <div className="space-y-8">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/20 blur-3xl pointer-events-none" />
      <div className="absolute -right-32 top-1/2 h-96 w-96 rounded-full bg-red-950/15 blur-3xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Orden de despacho
          </h1>
          <p className="mt-1 text-sm font-mono text-zinc-400">{order.id}</p>
        </div>

        <Link
          href="/dashboard/orders"
          className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white shadow-sm"
        >
          Volver
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 text-sm backdrop-blur-md shadow-xl">
        <div>
          <p className="text-zinc-400">Distribuidor de destino</p>
          <p className="font-medium text-white">{order.distributorName}</p>
        </div>
        <div>
          <p className="text-zinc-400">Estado</p>
          <p className="mt-1 inline-block">
            <span className={`rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md ${
              order.status === "confirmed" 
                ? "bg-emerald-950/60 border-emerald-900/40 text-emerald-300" 
                : "bg-red-950/60 border-red-900/40 text-red-300"
            }`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          </p>
        </div>
        <div>
          <p className="text-zinc-400">Fecha estimada de despacho</p>
          <p className="font-medium text-white">{order.estimatedDispatchDate}</p>
        </div>
        <div>
          <p className="text-zinc-400">Creada el</p>
          <p className="font-medium text-white">
            {new Date(order.createdAt).toLocaleDateString("es-AR")}
          </p>
        </div>
        {order.notes && (
          <div className="col-span-2 pt-2 border-t border-zinc-800">
            <p className="text-zinc-400">Observaciones</p>
            <p className="font-medium text-white">{order.notes}</p>
          </div>
        )}
      </div>

      {isWarehouseOperator && (
        <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 backdrop-blur-md shadow-xl">
          <PalletValidationPanel
            orderId={order.id}
            pallets={palletValidations}
            dispatchDiscrepancies={dispatchDiscrepancies}
          />
        </div>
      )}

      {isDistributorOperator && (
        <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 backdrop-blur-md shadow-xl">
          <PalletReceptionPanel
            orderId={order.id}
            pallets={palletReceptions}
            canReceive={order.status === "confirmed"}
          />
        </div>
      )}

      {canConfirm && (
        <div className="flex justify-end">
          <ConfirmDispatchButton
            orderId={order.id}
            missingPalletsCount={missingPalletsCount}
          />
        </div>
      )}

      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 backdrop-blur-md shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-white">
          Pallets asociados
        </h2>

        {associatedPallets.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Todavía no hay pallets asociados a esta orden.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-3 font-medium">QR</th>
                  <th className="py-3 font-medium">Producto</th>
                  <th className="py-3 font-medium">Lote</th>
                  <th className="py-3 font-medium">Estado</th>
                  {canAssociate && (
                    <th className="py-3 font-medium text-right">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {associatedPallets.map((pallet) => (
                  <tr key={pallet.id} className="transition-colors hover:bg-zinc-800/40">
                    <td className="py-3 font-mono text-zinc-200">{pallet.qrCode}</td>
                    <td className="py-3 text-zinc-200">
                      {pallet.productName} ({pallet.productSku})
                    </td>
                    <td className="py-3 text-zinc-300">{pallet.batchNumber}</td>
                    <td className="py-3 text-zinc-300">
                      {PALLET_STATUS_LABELS[pallet.status]}
                    </td>
                    {canAssociate && (
                      <td className="py-3 text-right">
                        <DissociatePalletButton
                          orderId={order.id}
                          palletId={pallet.id}
                          disabled={validatedAtByPalletId.get(pallet.id) != null}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canAssociate ? (
        <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 backdrop-blur-md shadow-xl">
          <h2 className="mb-4 text-base font-semibold text-white">
            Asociar pallets disponibles
          </h2>

          {availablePallets.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No hay pallets en depósito disponibles para asociar.
            </p>
          ) : (
            <AssociatePalletsForm orderId={order.id} pallets={availablePallets} />
          )}
        </div>
      ) : isLogisticsManager ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
          Esta orden ya no admite asociar pallets (estado:{" "}
          <span className="text-zinc-200 font-medium">{ORDER_STATUS_LABELS[order.status]}</span>).
        </div>
      ) : null}
    </div>
  );
}
