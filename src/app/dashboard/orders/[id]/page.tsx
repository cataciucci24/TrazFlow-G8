import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getDispatchOrderDetail, getOrderLinesComparison } from "@/lib/orders/queries";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { OrderLinesSummary } from "@/components/orders/order-lines-summary";
import { mismatchSummary } from "@/lib/orders/lines";
import { getAvailablePallets, getPalletsForOrder } from "@/lib/pallets/queries";
import { getBatchPickingPolicy } from "@/lib/erp-stock/queries";
import { sortPalletsForPicking } from "@/lib/pallets/picking";
import { formatPalletLocation } from "@/lib/locations/format";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { AssociatePalletsForm } from "@/components/orders/associate-pallets-form";
import { ConfirmDispatchButton } from "@/components/orders/confirm-dispatch-button";
import { DissociatePalletButton } from "@/components/orders/dissociate-pallet-button";
import { PalletValidationPanel } from "@/components/pallet-validation/pallet-validation-panel";
import { DriverAssignmentForm } from "@/components/orders/driver-assignment-form";
import { OrderNotificationsPanel } from "@/components/orders/order-notifications-panel";
import {
  getOrderDispatchDiscrepancies,
  getOrderPalletValidations,
} from "@/lib/pallet-validation/queries";
import { getOrderScanHistory } from "@/lib/scans/queries";
import { getOrderNotifications } from "@/lib/order-notifications/queries";
import { ErpOriginCell } from "@/components/erp/erp-origin";
import { OrderStatusBadge, EmptyState, InlineAlert, PageHeader, PalletStatusBadge, SectionHeader, TableShell } from "@/components/ui/design-system";

export const metadata: Metadata = {
  title: "Detalle de orden | TrazFlow",
};

export default async function DispatchOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ driver?: string }>;
}) {
  const profile = await requireUserProfile();

  const isLogisticsManager = hasRole(profile, "logistics_manager");
  const isWarehouseOperator = hasRole(profile, "warehouse_operator");
  const isDriverOperator = hasRole(profile, "driver_operator");

  if (isDriverOperator) {
    const { id } = await params;
    redirect(`/dashboard/deliveries/${id}`);
  }
  if (!isLogisticsManager && !isWarehouseOperator) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const order = await getDispatchOrderDetail(id);
  const { driver: driverResult } = await searchParams;

  if (!order) notFound();

  const canAssociate = isLogisticsManager && order.status === "draft";
  const needsPalletValidations = isWarehouseOperator || canAssociate;

  const canSeeNotifications = isLogisticsManager || isWarehouseOperator;
  // TRZ-100: pedido vs. armado, solo para órdenes del ERP y con la integración activa.
  const showLines = order.origin?.sourceSystem === "erp" && (await isErpEnabled(profile.companyId));

  // TRZ-65: con ERP, los pallets disponibles se ordenan según la regla de salida del ERP (solo sugerencia).
  const erpEnabled = await isErpEnabled(profile.companyId);
  const pickingPolicy = canAssociate && erpEnabled ? await getBatchPickingPolicy(profile.companyId) : null;

  const [
    associatedPallets,
    availablePallets,
    palletValidations,
    dispatchDiscrepancies,
    dispatchScanHistory,
    orderNotifications,
    linesComparison,
  ] = await Promise.all([
    getPalletsForOrder(id),
    canAssociate ? getAvailablePallets(profile.companyId) : Promise.resolve([]),
    needsPalletValidations ? getOrderPalletValidations(id) : Promise.resolve([]),
    isWarehouseOperator
      ? getOrderDispatchDiscrepancies(id)
      : Promise.resolve([]),
    isWarehouseOperator ? getOrderScanHistory(id, "dispatch") : Promise.resolve([]),
    canSeeNotifications ? getOrderNotifications(id) : Promise.resolve([]),
    showLines ? getOrderLinesComparison(id) : Promise.resolve(null),
  ]);

  const validatedAtByPalletId = new Map(
    palletValidations.map((pallet) => [pallet.id, pallet.validatedAt]),
  );

  const missingPalletsCount = palletValidations.filter(
    (pallet) => !pallet.validatedAt,
  ).length;
  // TRZ-100: si ya se sabe que no coincide, el botón se deshabilita (la base lo rechaza igual).
  const quantityMismatch = linesComparison?.hasLines ? mismatchSummary(linesComparison.rows) : null;
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
        {linesComparison ? <OrderLinesSummary {...linesComparison} /> : null}
        {canConfirm && <ConfirmDispatchButton orderId={order.id} missingPalletsCount={missingPalletsCount} quantityMismatch={quantityMismatch} />}
        <OrderNotificationsPanel notifications={orderNotifications} />
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader title="Detalle de orden" description={`Código ${order.id}`} action={<Link href="/dashboard/orders" className="button-secondary">Volver</Link>} />
      {driverResult === "assigned" && <InlineAlert variant="success">Chofer asignado correctamente.</InlineAlert>}
      {driverResult === "error" && <InlineAlert variant="danger">No se pudo asignar el chofer. Verificá que esté activo y pertenezca a tu empresa.</InlineAlert>}

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
          <p className="text-stone-500">Origen</p>
          <p className="mt-1"><ErpOriginCell origin={order.origin} /></p>
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
        <div className="sm:col-span-2 border-t border-stone-200 pt-4">
          <DriverAssignmentForm orderId={order.id} currentDriverId={order.driverId} currentDriverName={order.driverName} />
        </div>
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

      {canConfirm && (
        <div className="flex justify-end">
          <ConfirmDispatchButton
            orderId={order.id}
            missingPalletsCount={missingPalletsCount}
            quantityMismatch={quantityMismatch}
          />
        </div>
      )}

      <OrderNotificationsPanel notifications={orderNotifications} />

      {linesComparison ? <OrderLinesSummary {...linesComparison} /> : null}

      <section className="section-stack">
        <SectionHeader title="Pallets asociados" description="Mercadería vinculada actualmente a esta orden." />

        {associatedPallets.length === 0 ? (
          <div className="surface"><EmptyState title="Orden sin pallets asociados" description="Los pallets incorporados a esta orden aparecerán acá con su estado." /></div>
        ) : (
          <TableShell label="Pallets asociados a la orden" mobileLayout="rows">
            <table role="table" className="data-table min-w-[720px]">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">QR</th>
                  <th role="columnheader" scope="col">Producto</th>
                  <th role="columnheader" scope="col">Lote</th>
                  <th role="columnheader" scope="col">Ubicación</th>
                  <th role="columnheader" scope="col">Estado</th>
                  {canAssociate && (
                    <th role="columnheader" scope="col" className="text-right">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody role="rowgroup" className="divide-y divide-stone-200">
                {associatedPallets.map((pallet) => (
                  <tr role="row" key={pallet.id}>
                    <td role="cell" data-label="QR" className="mobile-primary break-all font-mono font-semibold">{pallet.qrCode}</td>
                    <td role="cell" data-label="Producto">{pallet.productName} ({pallet.productSku})</td>
                    <td role="cell" data-label="Lote" className="text-stone-600">{pallet.batchNumber}</td>
                    <td role="cell" data-label="Ubicación" className={`mobile-priority break-all font-mono text-xs ${pallet.location ? "font-semibold text-slate-700" : "text-stone-400"}`}>
                      {formatPalletLocation(pallet.location)}
                    </td>
                    <td role="cell" data-label="Estado" className="mobile-priority">
                      <PalletStatusBadge status={pallet.status} />
                    </td>
                    {canAssociate && (
                      <td role="cell" data-label="Acciones" className="mobile-actions text-right">
                        <div className="table-row-actions">
                          <DissociatePalletButton
                            orderId={order.id}
                            palletId={pallet.id}
                            disabled={validatedAtByPalletId.get(pallet.id) != null}
                          />
                        </div>
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
            <div className="surface p-6">
              <AssociatePalletsForm orderId={order.id}
                pallets={pickingPolicy ? sortPalletsForPicking(availablePallets, pickingPolicy) : availablePallets}
                pickingPolicy={pickingPolicy} />
            </div>
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
