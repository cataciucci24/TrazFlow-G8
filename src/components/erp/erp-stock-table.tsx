import { formatSyncedAt } from "@/components/erp/erp-origin";
import { Badge, EmptyState, SectionHeader, TableShell } from "@/components/ui/design-system";
import { erpLotExpiration, sortByExpirationRisk, todayInArgentina } from "@/lib/erp-stock/expiration";
import { formatStockQuantity, type ErpStockRow } from "@/lib/erp-stock/types";

/**
 * "Stock según ERP" (TRZ-64): saldos por lote y depósito tal como los informa el ERP, con su vencimiento.
 * Solo lectura: TrazFlow no calcula stock. Los vencidos y los que vencen pronto quedan arriba y resaltados.
 */
export function ErpStockTable({ rows, expiringDays }: { rows: ErpStockRow[]; expiringDays: number }) {
  const today = todayInArgentina();
  const sorted = sortByExpirationRisk(rows, today, expiringDays);
  const oldest = rows.reduce<string | null>((min, row) => (!min || row.oldestSyncedAt < min ? row.oldestSyncedAt : min), null);

  return <section className="section-stack">
    <SectionHeader title="Stock según ERP"
      description={oldest ? `Saldos por lote y depósito informados por el ERP. Datos al ${formatSyncedAt(oldest)}.` : "Saldos por lote y depósito informados por el ERP."} />
    {sorted.length === 0
      ? <div className="surface"><EmptyState title="Sin saldos del ERP" description="Sincronizá con el ERP para ver el stock y los vencimientos de cada lote." /></div>
      : <TableShell label="Stock según ERP" mobileLayout="rows">
        <table role="table" aria-label="Stock según ERP" className="data-table min-w-[820px]">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Producto</th>
              <th role="columnheader" scope="col">Lote</th>
              <th role="columnheader" scope="col">Depósito</th>
              <th role="columnheader" scope="col" className="text-right">Saldo ERP</th>
              <th role="columnheader" scope="col" className="text-right">Disponible para armar</th>
              <th role="columnheader" scope="col">Vencimiento</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {sorted.map((row) => {
              const expiration = erpLotExpiration(row.expirationDate, today, expiringDays);
              return <tr role="row" key={`${row.batchId}:${row.warehouseCode}`}>
                <td role="cell" data-label="Producto" className="mobile-primary">
                  <span className="font-semibold">{row.productName}</span>
                  <span className="block font-mono text-xs text-stone-500">{row.productSku}</span>
                </td>
                <td role="cell" data-label="Lote" className="font-mono text-sm">{row.batchNumber}</td>
                <td role="cell" data-label="Depósito" className="font-mono text-sm">{row.warehouseCode}</td>
                <td role="cell" data-label="Saldo ERP" className="text-right">{formatStockQuantity(row.erpQuantity, row.unitOfMeasure)}</td>
                <td role="cell" data-label="Disponible para armar" className="text-right text-stone-600">{formatStockQuantity(row.available, row.unitOfMeasure)}</td>
                <td role="cell" data-label="Vencimiento" className="mobile-priority">
                  {row.expirationDate ? <span className="mr-2 text-sm">{formatDate(row.expirationDate)}</span> : null}
                  <ExpirationBadge status={expiration.status} days={expiration.days} />
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </TableShell>}
  </section>;
}

function ExpirationBadge({ status, days }: { status: ReturnType<typeof erpLotExpiration>["status"]; days: number | null }) {
  if (status === "expired") return <Badge tone="danger">Vencido</Badge>;
  if (status === "expiring") return <Badge tone="warning">{days === 0 ? "Vence hoy" : `Vence en ${days} día${days === 1 ? "" : "s"}`}</Badge>;
  if (status === "none") return <span className="text-sm text-stone-500">Sin vencimiento</span>;
  return null;
}

function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
