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
import { getOrderScanHistory } from "@/lib/scans/queries";

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
    dispatchScanHistory,
    receptionScanHistory,
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
    isWarehouseOperator ? getOrderScanHistory(id, "dispatch") : Promise.resolve([]),
    isDistributorOperator ? getOrderScanHistory(id, "reception") : Promise.resolve([]),
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

  if (isWarehouseOperator) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Confirmar despacho</h1>
        <PalletValidationPanel
          orderId={order.id}
          pallets={palletValidations}
          dispatchDiscrepancies={dispatchDiscrepancies}
          initialScanHistory={dispatchScanHistory}
        />
        {canConfirm && <ConfirmDispatchButton orderId={order.id} missingPalletsCount={missingPalletsCount} />}
      </div>
    );
  }

  if (isDistributorOperator) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Confirmar recepción</h1>
        <PalletReceptionPanel orderId={order.id} pallets={palletReceptions} canReceive={order.status === "confirmed"} initialScanHistory={receptionScanHistory} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isDistributorOperator ? "Confirmar recepción" : "Confirmar despacho"}
          </h1>
          <p className="mt-1 font-mono text-sm text-stone-500">{order.id}</p>
        </div>

        <Link
          href="/dashboard/orders"
          className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50"
        >
          Volver
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-stone-200 bg-white p-6 text-sm sm:grid-cols-2">
        <div>
          <p className="text-stone-500">Distribuidor de destino</p>
          <p className="font-semibold">{order.distributorName}</p>
        </div>
        <div>
          <p className="text-stone-500">Estado</p>
          <p className="mt-1 inline-block">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${
              order.status === "confirmed" 
                ? "bg-emerald-50 text-emerald-600"
                : "bg-amber-50 text-amber-600"
            }`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          </p>
        </div>
        <div>
          <p className="text-stone-500">Fecha estimada de despacho</p>
          <p className="font-semibold">{order.estimatedDispatchDate}</p>
        </div>
        <div>
          <p className="text-stone-500">Creada el</p>
          <p className="font-semibold">
            {new Date(order.createdAt).toLocaleDateString("es-AR")}
          </p>
        </div>
        {order.notes && (
          <div className="col-span-2 border-t border-stone-200 pt-2">
            <p className="text-stone-500">Observaciones</p>
            <p className="font-medium">{order.notes}</p>
          </div>
        )}
      </div>

      {isWarehouseOperator && (
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <PalletValidationPanel
            orderId={order.id}
            pallets={palletValidations}
            dispatchDiscrepancies={dispatchDiscrepancies}
            initialScanHistory={dispatchScanHistory}
          />
        </div>
      )}

      {isDistributorOperator && (
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <PalletReceptionPanel
            orderId={order.id}
            pallets={palletReceptions}
            canReceive={order.status === "confirmed"}
            initialScanHistory={receptionScanHistory}
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

      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold">
          Pallets asociados
        </h2>

        {associatedPallets.length === 0 ? (
          <p className="text-sm text-stone-500">
            Todavía no hay pallets asociados a esta orden.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-3 font-medium">QR</th>
                  <th className="py-3 font-medium">Producto</th>
                  <th className="py-3 font-medium">Lote</th>
                  <th className="py-3 font-medium">Estado</th>
                  {canAssociate && (
                    <th className="py-3 font-medium text-right">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {associatedPallets.map((pallet) => (
                  <tr key={pallet.id} className="transition-colors hover:bg-amber-50/40">
                    <td className="py-3 font-mono font-semibold">{pallet.qrCode}</td>
                    <td className="py-3">
                      {pallet.productName} ({pallet.productSku})
                    </td>
                    <td className="py-3 text-stone-600">{pallet.batchNumber}</td>
                    <td className="py-3 text-stone-600">
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
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold">
            Asociar pallets disponibles
          </h2>

          {availablePallets.length === 0 ? (
            <p className="text-sm text-stone-500">
              No hay pallets en depósito disponibles para asociar.
            </p>
          ) : (
            <AssociatePalletsForm orderId={order.id} pallets={availablePallets} />
          )}
        </div>
      ) : isLogisticsManager ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
          Esta orden ya no admite asociar pallets (estado:{" "}
          <span className="font-medium text-slate-950">{ORDER_STATUS_LABELS[order.status]}</span>).
        </div>
      ) : null}
    </div>
  );
}
