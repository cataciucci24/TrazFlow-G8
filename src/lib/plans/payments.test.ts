import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoicePdf, invoiceFilename } from "./invoice-pdf.ts";
import { argentinaToday, formatPaymentDate, hasInvoice, paidThrough, toPayment, type CompanyPayment, type PaymentRow } from "./payments.ts";

const row: PaymentRow = {
  id: "p1", plan_name: "Growth", billed_to: "Logística (Sur) \\ SA", amount_cents: 26900, currency: "USD", status: "paid",
  payment_date: "2026-11-01", period_start: "2026-11-01", period_end: "2026-11-30", invoice_number: "A-0001",
};
const payment = (over: Partial<CompanyPayment> = {}): CompanyPayment => ({ ...toPayment(row), ...over });

test("las fechas sin hora no se corren de día", () => {
  assert.equal(formatPaymentDate("2026-11-01"), "1/11/26");
  assert.equal(formatPaymentDate("2026-11-30"), "30/11/26");
});

test("el día en Argentina cambia a las 03:00 UTC", () => {
  assert.equal(argentinaToday(new Date("2026-12-01T02:59:00Z")), "2026-11-30");
  assert.equal(argentinaToday(new Date("2026-12-01T03:00:00Z")), "2026-12-01");
});

test("paidThrough toma el último período pagado vigente e ignora los demás estados", () => {
  const today = "2026-11-15";
  assert.equal(paidThrough([], today), null);
  assert.equal(paidThrough([payment({ periodEnd: "2026-10-31" })], today), null);
  assert.equal(paidThrough([payment({ periodEnd: today })], today), today);
  assert.equal(paidThrough([payment({ periodEnd: "2026-11-30" }), payment({ periodEnd: "2026-12-31" }), payment({ periodEnd: "2026-10-31" })], today), "2026-12-31");
  for (const status of ["pending", "failed", "refunded", "canceled"] as const) {
    assert.equal(paidThrough([payment({ status, periodEnd: "2026-12-31" })], today), null);
  }
});

test("solo pagos cobrados o reembolsados con número tienen factura", () => {
  assert.equal(hasInvoice(payment()), true);
  assert.equal(hasInvoice(payment({ status: "refunded" })), true);
  assert.equal(hasInvoice(payment({ invoiceNumber: null })), false);
  for (const status of ["pending", "failed", "canceled"] as const) assert.equal(hasInvoice(payment({ status })), false);
});

test("el nombre del archivo no admite caracteres de encabezado ni rutas", () => {
  assert.equal(invoiceFilename('A/0001"\r\nX'), "factura-A-0001-X.pdf");
});

test("el PDF escapa el texto, conserva acentos y tiene un xref válido", () => {
  const bytes = buildInvoicePdf(payment());
  const pdf = Buffer.from(bytes).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.includes("Logística \\(Sur\\) \\\\ SA"));
  assert.ok(pdf.includes("Factura A-0001"));
  assert.ok(pdf.includes("No reemplaza al comprobante fiscal"));
  const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n/gm)].map(match => Number(match[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, index) => assert.ok(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)));
});
