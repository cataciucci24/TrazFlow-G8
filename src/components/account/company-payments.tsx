import { Badge, EmptyState, InlineAlert, TableShell } from "@/components/ui/design-system";
import { formatPaymentDate, hasInvoice, PAYMENT_STATUS, type CompanyPayment } from "@/lib/plans/payments";
import { formatPlanPrice } from "@/lib/plans/types";

export function PaymentsTable({ available, payments }: { available: boolean; payments: CompanyPayment[] }) {
  if (!available) return <InlineAlert variant="warning">No pudimos cargar tus pagos. Actualizá la página para reintentar.</InlineAlert>;
  if (payments.length === 0) return <div className="surface"><EmptyState title="Todavía no hay pagos" description="Cuando se registre un pago de tu empresa, va a aparecer en esta lista." /></div>;
  return <TableShell label="Pagos de la empresa" mobileLayout="rows">
    <table role="table" aria-label="Pagos de la empresa" className="data-table min-w-[720px]">
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col">Fecha</th>
          <th role="columnheader" scope="col">Período</th>
          <th role="columnheader" scope="col">Plan</th>
          <th role="columnheader" scope="col" className="text-right">Monto</th>
          <th role="columnheader" scope="col">Estado</th>
          <th role="columnheader" scope="col">Factura</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {payments.map(payment => {
          const status = PAYMENT_STATUS[payment.status];
          return <tr role="row" key={payment.id}>
            <td role="cell" data-label="Fecha" className="mobile-primary">{formatPaymentDate(payment.paymentDate)}</td>
            <td role="cell" data-label="Período">{formatPaymentDate(payment.periodStart)} al {formatPaymentDate(payment.periodEnd)}</td>
            <td role="cell" data-label="Plan">{payment.planName}</td>
            <td role="cell" data-label="Monto" className="text-right font-semibold">{formatPlanPrice(payment.amountCents, payment.currency)}</td>
            <td role="cell" data-label="Estado"><Badge tone={status.tone}>{status.label}</Badge></td>
            <td role="cell" data-label="Factura" className="mobile-actions">
              {hasInvoice(payment)
                ? <a href={`/dashboard/account/payments/${payment.id}/invoice`} download className="underline" aria-label={`Descargar factura ${payment.invoiceNumber}`}>Descargar</a>
                : <span className="text-stone-500">No disponible</span>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </TableShell>;
}
