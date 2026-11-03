import { formatPaymentDate, PAYMENT_STATUS, type CompanyPayment } from "./payments.ts";
import { formatPlanPrice } from "./types.ts";

export const INVOICE_FISCAL_NOTICE = "Documento interno de respaldo. No reemplaza al comprobante fiscal electrónico (ARCA).";

const escapePdfText = (text: string) => text.replace(/[\\()]/g, "\\$&").replace(/[\r\n]+/g, " ");

export function invoiceFilename(invoiceNumber: string): string {
  return `factura-${invoiceNumber.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
}

/** PDF de una página con Helvetica; WinAnsi cubre el español y lo demás sale como "?". */
export function buildInvoicePdf(payment: CompanyPayment): Uint8Array {
  const lines: [number, string][] = [
    [20, "TrazFlow"],
    [14, `Factura ${payment.invoiceNumber ?? ""}`],
    [11, ""],
    [11, `Cliente: ${payment.billedTo}`],
    [11, `Fecha de pago: ${formatPaymentDate(payment.paymentDate)}`],
    [11, `Concepto: Suscripción mensual, plan ${payment.planName}`],
    [11, `Período: ${formatPaymentDate(payment.periodStart)} al ${formatPaymentDate(payment.periodEnd)}`],
    [11, `Estado: ${PAYMENT_STATUS[payment.status].label}`],
    [11, ""],
    [14, `Total: ${formatPlanPrice(payment.amountCents, payment.currency)} (${payment.currency})`],
    [11, ""],
    [9, INVOICE_FISCAL_NOTICE],
  ];
  let y = 780;
  const content = lines.map(([size, text]) => {
    y -= size + 12;
    return `BT /F1 ${size} Tf 50 ${y} Td (${escapePdfText(text)}) Tj ET`;
  }).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  // Con latin1 cada carácter ocupa un byte, así que los offsets del xref son posiciones del string.
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf.replace(/[^\x00-\xff]/g, "?"), "latin1"));
}
