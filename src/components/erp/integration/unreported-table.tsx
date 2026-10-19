import Link from "next/link";

import { formatSyncedAt } from "@/components/erp/erp-origin";
import { IntegrationBadgeView } from "@/components/erp/integration/integration-badge";
import { EmptyState, OrderStatusBadge, TableShell } from "@/components/ui/design-system";
import { activityBadge } from "@/lib/erp-integration/status";
import { ACTIVITY_STATUS_LABELS, type UnreportedOrder } from "@/lib/erp-integration/types";
import type { OrderStatus } from "@/lib/types";

/** Órdenes del ERP que salieron físicamente y cuyo despacho todavía no quedó registrado en el ERP. */
export function UnreportedTable({ rows, detailHref }: { rows: UnreportedOrder[]; detailHref: (eventId: string) => string }) {
  if (rows.length === 0) {
    return <div className="surface"><EmptyState title="Todo lo despachado está reportado"
      description="No hay órdenes del ERP despachadas físicamente pendientes de informar." /></div>;
  }
  return (
    <TableShell label="Órdenes despachadas sin reportar al ERP" mobileLayout="rows">
      <table role="table" aria-label="Órdenes despachadas sin reportar al ERP" className="data-table min-w-[860px]">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Orden del ERP</th>
            <th role="columnheader" scope="col">Despachada</th>
            <th role="columnheader" scope="col">Estado de la orden</th>
            <th role="columnheader" scope="col">Reporte al ERP</th>
            <th role="columnheader" scope="col" className="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr role="row" key={row.orderId}>
              <td role="cell" data-label="Orden del ERP" className="mobile-primary">
                <span className="font-mono font-bold">{row.orderExternalId}</span>
                {row.distributorName ? <span className="block text-xs text-stone-500">{row.distributorName}</span> : null}
              </td>
              <td role="cell" data-label="Despachada" className="text-stone-700">{formatSyncedAt(row.confirmedAt)}</td>
              <td role="cell" data-label="Estado de la orden"><OrderStatusBadge status={row.orderStatus as OrderStatus} /></td>
              <td role="cell" data-label="Reporte al ERP" className="mobile-priority text-sm">
                {row.eventStatus === "missing"
                  ? <span className="font-medium text-red-700">Sin reporte generado</span>
                  : <>
                      <IntegrationBadgeView badge={activityBadge("dispatch_confirmed", row.eventStatus)} detail={ACTIVITY_STATUS_LABELS[row.eventStatus]} />
                      {row.lastErrorCode ? <span className="ml-2 font-mono text-xs text-stone-500">{row.lastErrorCode}</span> : null}
                      {row.eventStatus === "pending" && row.nextAttemptAt
                        ? <span className="block text-xs text-stone-500">Próximo intento {formatSyncedAt(row.nextAttemptAt)}</span>
                        : null}
                    </>}
              </td>
              <td role="cell" data-label="Acciones" className="mobile-actions text-right">
                <div className="table-row-actions">
                  <Link href={`/dashboard/orders/${row.orderId}`} className="button-secondary button-sm">Ver orden</Link>
                  {row.eventId ? <Link href={detailHref(row.eventId)} className="button-secondary button-sm" scroll={false}>Ver reporte</Link> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}
