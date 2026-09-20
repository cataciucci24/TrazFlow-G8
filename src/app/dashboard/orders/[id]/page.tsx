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
import { OrderNotificationsPanel } from "@/components/orders/order-notifications-panel";
import {
  getOrderDispatchDiscrepancies,
  getOrderPalletValidations,
} from "@/lib/pallet-validation/queries";
import { getOrderPalletReceptions } from "@/lib/pallet-reception/queries";
import { getOrderScanHistory } from "@/lib/scans/queries";
import { getOrderNotifications } from "@/lib/order-notifications/queries";
import { OrderStatusBadge, PageHeader, SectionHeader, TableShell } from "@/components/ui/design-system";

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

  const canSeeNotifications = isLogisticsManager || isWarehouseOperator;

  const [
    associatedPallets,
    availablePallets,
    palletValidations,
    dispatchDiscrepancies,
    palletReceptions,
    dispatchScanHistory,
    receptionScanHistory,
    orderNotifications,
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
    canSeeNotifications ? getOrderNotifications(id) : Promise.resolve([]),
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
      <div className="app-page">
        <PageHeader title="Confirmar despacho" description="Validá los pallets asignados antes de confirmar la salida." action={<Link href="/dashboard" className="button-secondary">Volver</Link>} />
        <PalletValidationPanel
          orderId={order.id}
          pallets={palletValidations}
          dispatchDiscrepancies={dispatchDiscrepancies}
          initialScanHistory={dispatchScanHistory}
        />
        {canConfirm && <ConfirmDispatchButton orderId={order.id} missingPalletsCount={missingPalletsCount} />}
        <OrderNotificationsPanel notifications={orderNotifications} />
      </div>
    );
  }

  if (isDistributorOperator) {
    return (
      <div className="app-page">
        <PageHeader title="Confirmar recepción" description="Registrá la recepción de los pallets incluidos en la orden." action={<Link href="/dashboard" className="button-secondary">Volver</Link>} />
        <PalletReceptionPanel orderId={order.id} pallets={palletReceptions} canReceive={order.status === "confirmed"} initialScanHistory={receptionScanHistory} />
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader title="Detalle de orden" description={`Código ${order.id}`} action={<Link href="/dashboard/orders" className="button-secondary">Volver</Link>} />

      <section className="section-stack">
      <SectionHeader title="Información de la orden" description="Destino, fechas y estado operativo actual." />
      <div className="surface grid grid-cols-1 gap-5 p-6 text-sm sm:grid-cols-2">
        <div>
          <p className="text-stone-500">Distribuidor de destino</p>
          <p className="font-semibold">{order.distributorName}</p>
        </div>
        <div>
          <p className="text-stone-500">Estado</p>
          <p className="mt-1 inline-block">
            <OrderStatusBadge status={order.status} />
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
      </section>

      {isWarehouseOperator && (
        <div className="surface p-6">
          <PalletValidationPanel
            orderId={order.id}
            pallets={palletValidations}
            dispatchDiscrepancies={dispatchDiscrepancies}
            initialScanHistory={dispatchScanHistory}
          />
        </div>
      )}

      {isDistributorOperator && (
        <div className="surface p-6">
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

      <OrderNotificationsPanel notifications={orderNotifications} />

      <section className="section-stack">
        <SectionHeader title="Pallets asociados" description="Mercadería vinculada actualmente a esta orden." />

        {associatedPallets.length === 0 ? (
          <p className="surface p-6 text-sm text-stone-500">
            Todavía no hay pallets asociados a esta orden.
          </p>
        ) : (
          <TableShell label="Pallets asociados a la orden">
            <table className="data-table min-w-[700px]">
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
                  <tr key={pallet.id} className="transition-colors hover:bg-[var(--brand-soft)]">
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
          </TableShell>
        )}
      </section>

      {canAssociate ? (
        <section className="section-stack">
          <SectionHeader title="Asociar pallets disponibles" description="Seleccioná pallets en depósito para incorporarlos a la orden." />

          {availablePallets.length === 0 ? (
            <p className="surface p-6 text-sm text-stone-500">
              No hay pallets en depósito disponibles para asociar.
            </p>
          ) : (
            <div className="surface p-6"><AssociatePalletsForm orderId={order.id} pallets={availablePallets} /></div>
          )}
        </section>
      ) : isLogisticsManager ? (
        <div className="feedback border-slate-200 bg-slate-50 text-slate-600">
          Esta orden ya no admite asociar pallets (estado:{" "}
          <span className="font-medium text-slate-950">{ORDER_STATUS_LABELS[order.status]}</span>).
        </div>
      ) : null}
    </div>
  );
}
