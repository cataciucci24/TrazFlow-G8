export type PaymentStatus = "paid" | "pending" | "failed" | "refunded" | "canceled";

export type CompanyPayment = {
  id: string; planName: string; billedTo: string; amountCents: number; currency: string;
  status: PaymentStatus; paymentDate: string; periodStart: string; periodEnd: string;
  invoiceNumber: string | null;
};

export type PaymentRow = {
  id: string; plan_name: string; billed_to: string; amount_cents: number; currency: string;
  status: PaymentStatus; payment_date: string; period_start: string; period_end: string;
  invoice_number: string | null;
};

export const PAYMENT_SELECT = "id, plan_name, billed_to, amount_cents, currency, status, payment_date, period_start, period_end, invoice_number";

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  paid: { label: "Pagado", tone: "success" },
  pending: { label: "Pendiente", tone: "warning" },
  failed: { label: "Rechazado", tone: "danger" },
  refunded: { label: "Reembolsado", tone: "neutral" },
  canceled: { label: "Anulado", tone: "neutral" },
};

export function toPayment(row: PaymentRow): CompanyPayment {
  return {
    id: row.id, planName: row.plan_name, billedTo: row.billed_to, amountCents: row.amount_cents,
    currency: row.currency, status: row.status, paymentDate: row.payment_date,
    periodStart: row.period_start, periodEnd: row.period_end, invoiceNumber: row.invoice_number,
  };
}

/** Un pago rechazado o pendiente no tiene factura, aunque se le haya cargado un número. */
export function hasInvoice(payment: CompanyPayment): boolean {
  return payment.invoiceNumber !== null && (payment.status === "paid" || payment.status === "refunded");
}

/** Las fechas de pagos no tienen hora: se formatean en UTC para no correrse un día. */
export function formatPaymentDate(date: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function argentinaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now);
}

/** Último día ya pagado que sigue vigente. Anticipa lo que resuelve cancel_company_subscription. */
export function paidThrough(payments: readonly CompanyPayment[], today: string): string | null {
  return payments.reduce<string | null>((latest, payment) =>
    payment.status === "paid" && payment.periodEnd >= today && (latest === null || payment.periodEnd > latest)
      ? payment.periodEnd : latest, null);
}

export type SubscriptionAccess = {
  available: boolean; canceledAt: string | null; accessUntil: string | null; ended: boolean;
};

export type CancelSubscriptionState = { error: string | null };

export const cancelSubscriptionMessages: Record<string, string> = {
  confirmation_required: "Confirmá que querés cancelar la suscripción.",
  unassigned: "Tu empresa no tiene un plan asignado.",
  no_paid_period: "No hay un período pagado vigente. Comunicate con el equipo comercial para gestionar la baja.",
};
