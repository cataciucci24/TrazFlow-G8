import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getDispatchOrderDetail } from "@/lib/orders/queries";
import { getAvailablePallets, getPalletsForOrder } from "@/lib/pallets/queries";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
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
import { OrderStatusBadge, EmptyState, InlineAlert, PageHeader, PalletStatusBadge, SectionHeader, TableShell } from "@/components/ui/design-system";

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
          <div className="sm:col-span-2 border-t border-stone-200 pt-2">
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
          <div className="surface"><EmptyState title="Orden sin pallets asociados" description="Los pallets incorporados a esta orden aparecerán acá con su estado." /></div>
        ) : (
          <TableShell label="Pallets asociados a la orden">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th scope="col">QR</th>
                  <th scope="col">Producto</th>
                  <th scope="col" className="table-secondary-column">Lote</th>
                  <th scope="col">Estado</th>
                  {canAssociate && (
                    <th scope="col" className="text-right">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {associatedPallets.map((pallet) => (
                  <tr key={pallet.id}>
                    <td className="font-mono font-semibold">{pallet.qrCode}</td>
                    <td>
                      {pallet.productName} ({pallet.productSku})
                      <span className="table-secondary block md:hidden">Lote {pallet.batchNumber}</span>
                    </td>
                    <td className="table-secondary-column text-stone-600">{pallet.batchNumber}</td>
                    <td>
                      <PalletStatusBadge status={pallet.status} />
                    </td>
                    {canAssociate && (
                      <td className="text-right">
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
            <div className="surface"><EmptyState title="Sin pallets disponibles" description="No hay pallets en depósito disponibles para incorporar a esta orden." /></div>
          ) : (
            <div className="surface p-6"><AssociatePalletsForm orderId={order.id} pallets={availablePallets} /></div>
          )}
        </section>
      ) : isLogisticsManager ? (
        <InlineAlert>
          Esta orden ya no admite asociar pallets (estado:{" "}
          <span className="font-medium text-slate-950">{ORDER_STATUS_LABELS[order.status]}</span>).
        </InlineAlert>
      ) : null}
    </div>
  );
}
