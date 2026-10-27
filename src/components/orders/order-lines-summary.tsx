import { Badge, InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { differenceWarning, type OrderProductComparison } from "@/lib/orders/lines";

/**
 * Pedido vs. armado por producto de una orden del ERP (TRZ-100). Es solo un aviso: no bloquea la validación ni
 * la confirmación del despacho.
 */
export function OrderLinesSummary({ hasLines, rows }: { hasLines: boolean; rows: OrderProductComparison[] }) {
  const format = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
  const mismatched = rows.filter((row) => row.difference !== 0);

  return (
    <section className="section-stack" aria-label="Pedido y armado">
      <SectionHeader title="Pedido vs. armado" description="Lo que pide la orden en el ERP comparado con los pallets asociados." />
      {!hasLines ? (
        <InlineAlert variant="info" announce={false}>Esta orden se importó sin líneas del ERP.</InlineAlert>
      ) : (
        <>
          {mismatched.length > 0 ? (
            <InlineAlert variant="warning" announce={false}>
              El armado no coincide con lo pedido: {mismatched.map((row) => `${row.productName}, ${differenceWarning(row)}`).join("; ")}. Es solo un aviso: se puede validar y confirmar igual.
            </InlineAlert>
          ) : null}
          <TableShell label="Pedido y armado por producto" mobileLayout="rows">
            <table role="table" className="data-table min-w-[560px]">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Producto</th>
                  <th role="columnheader" scope="col" className="text-right">Pedido</th>
                  <th role="columnheader" scope="col" className="text-right">Armado</th>
                  <th role="columnheader" scope="col">Diferencia</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => {
                  const warning = differenceWarning(row);
                  return (
                    <tr role="row" key={row.productId}>
                      <td role="cell" data-label="Producto" className="mobile-primary font-medium">{row.productName} <span className="text-xs text-stone-500">({row.productSku})</span></td>
                      <td role="cell" data-label="Pedido" className="text-right">{format.format(row.requested)} {row.unitOfMeasure}</td>
                      <td role="cell" data-label="Armado" className="text-right">{format.format(row.built)} {row.unitOfMeasure}</td>
                      <td role="cell" data-label="Diferencia" className="mobile-priority">
                        {warning ? <Badge tone="warning">{warning}</Badge> : <Badge tone="success">Coincide</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </>
      )}
    </section>
  );
}
