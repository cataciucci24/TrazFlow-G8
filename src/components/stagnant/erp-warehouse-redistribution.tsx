import { formatSyncedAt } from "@/components/erp/erp-origin";
import { EmptyState, SectionHeader, TableShell } from "@/components/ui/design-system";
import { formatStockQuantity } from "@/lib/erp-stock/types";
import type { WarehouseRedistribution } from "@/lib/redistribution/erp-warehouses";

/** TRZ-72: sugerencias de redistribución entre depósitos calculadas con los saldos del ERP. */
export function ErpWarehouseRedistribution({ suggestions, syncedAt }: { suggestions: WarehouseRedistribution[]; syncedAt: string | null }) {
  return <section className="section-stack">
    <SectionHeader title="Redistribución entre depósitos"
      description={`Según los saldos del ERP${syncedAt ? ` al ${formatSyncedAt(syncedAt)}` : ""}: se sugiere mover stock cuando un depósito tiene menos de la mitad que otro del mismo producto.`} />
    {suggestions.length === 0
      ? <div className="surface"><EmptyState title="Sin sugerencias" description="Los saldos del ERP están parejos entre depósitos. Sincronizá con el ERP si cambiaron." /></div>
      : <TableShell label="Redistribución entre depósitos" mobileLayout="rows">
        <table role="table" aria-label="Redistribución entre depósitos" className="data-table min-w-[760px]">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Producto</th>
              <th role="columnheader" scope="col">Desde</th>
              <th role="columnheader" scope="col">Hacia</th>
              <th role="columnheader" scope="col" className="text-right">Mover</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {suggestions.map((item) => <tr role="row" key={`${item.productSku}:${item.fromWarehouse}:${item.toWarehouse}`}>
              <td role="cell" data-label="Producto" className="mobile-primary">
                <span className="font-semibold">{item.productName}</span>
                <span className="block font-mono text-xs text-stone-500">{item.productSku}</span>
              </td>
              <td role="cell" data-label="Desde"><span className="font-mono">{item.fromWarehouse}</span>
                <span className="block text-xs text-stone-500">tiene {formatStockQuantity(item.fromQuantity, item.unitOfMeasure)}</span></td>
              <td role="cell" data-label="Hacia"><span className="font-mono">{item.toWarehouse}</span>
                <span className="block text-xs text-stone-500">tiene {formatStockQuantity(item.toQuantity, item.unitOfMeasure)}</span></td>
              <td role="cell" data-label="Mover" className="mobile-priority text-right font-semibold">{formatStockQuantity(item.suggestedQuantity, item.unitOfMeasure)}</td>
            </tr>)}
          </tbody>
        </table>
      </TableShell>}
  </section>;
}
