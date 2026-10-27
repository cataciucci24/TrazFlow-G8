import Link from "next/link";

import { formatSyncedAt } from "@/components/erp/erp-origin";
import { IntegrationBadgeView } from "@/components/erp/integration/integration-badge";
import { EmptyState, TableShell } from "@/components/ui/design-system";
import { activityBadge } from "@/lib/erp-integration/status";
import { ACTIVITY_KIND_LABELS, ACTIVITY_STATUS_LABELS, ERP_DOCUMENT_STATUS_LABELS, type ActivityRow } from "@/lib/erp-integration/types";

export function ActivityTable({ rows, detailHref, emptyTitle, emptyDescription, emptyAction }: {
  rows: ActivityRow[];
  detailHref: (row: ActivityRow) => string;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="surface"><EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} /></div>;
  }
  return (
    <TableShell label="Actividad de la integración ERP" mobileLayout="rows">
      <table role="table" aria-label="Actividad de la integración ERP" className="data-table min-w-[900px]">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Fecha</th>
            <th role="columnheader" scope="col">Tipo</th>
            <th role="columnheader" scope="col">Estado</th>
            <th role="columnheader" scope="col">Referencia</th>
            <th role="columnheader" scope="col">Error</th>
            <th role="columnheader" scope="col" className="text-right">Detalle</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr role="row" key={`${row.kind}:${row.id}`}>
              <td role="cell" data-label="Fecha" className="mobile-primary text-stone-700">{formatSyncedAt(row.occurredAt)}</td>
              <td role="cell" data-label="Tipo">{ACTIVITY_KIND_LABELS[row.kind]}</td>
              <td role="cell" data-label="Estado" className="mobile-priority">
                <IntegrationBadgeView badge={activityBadge(row.kind, row.status)} detail={ACTIVITY_STATUS_LABELS[row.status]} />
                {row.attempts !== null ? <span className="ml-2 text-xs text-stone-500">{row.attempts} intento(s)</span> : null}
              </td>
              <td role="cell" data-label="Referencia" className="font-mono text-xs text-stone-700">
                {row.kind === "sync"
                  ? `Proveedor ${row.provider ?? "—"}`
                  : <>
                      {row.orderExternalId ?? "Orden sin id externo"}
                      {row.palletCount !== null ? <span className="block font-sans text-stone-500">{row.palletCount} pallet(s)</span> : null}
                      {row.erpReference ? <span className="block font-sans text-stone-500">Remito {row.erpReference}</span> : null}
                      {row.status === "sent"
                        ? <span className="block font-sans text-stone-500">Remito en el ERP: {row.erpDocumentStatus ? ERP_DOCUMENT_STATUS_LABELS[row.erpDocumentStatus] : "Sin consultar"}</span>
                        : null}
                    </>}
              </td>
              <td role="cell" data-label="Error" className="mobile-wide max-w-80 text-sm text-stone-600">
                {row.errorMessage
                  ? <>{row.errorCode ? <span className="font-mono text-xs">[{row.errorCode}] </span> : null}{row.errorMessage}</>
                  : row.errorCount > 0 ? `${row.errorCount} registro(s) con error` : "—"}
              </td>
              <td role="cell" data-label="Detalle" className="mobile-actions text-right">
                <Link href={detailHref(row)} className="button-secondary button-sm" scroll={false}>Ver detalle</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}
