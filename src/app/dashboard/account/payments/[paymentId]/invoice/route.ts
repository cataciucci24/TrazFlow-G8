import { canAccessDashboard } from "@/lib/auth/profile";
import { getUserProfile } from "@/lib/auth/session";
import { buildInvoicePdf, invoiceFilename } from "@/lib/plans/invoice-pdf";
import { hasInvoice } from "@/lib/plans/payments";
import { getCompanyPayment } from "@/lib/plans/payments-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// No usa requireUserProfile: las facturas siguen disponibles después del fin del período pagado.
export async function GET(_request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const profile = await getUserProfile();
  if (!profile) return new Response("No autenticado", { status: 401 });
  if (!canAccessDashboard(profile) || profile.role !== "logistics_manager") return new Response("Sin permisos", { status: 403 });
  const { paymentId } = await params;
  if (!UUID.test(paymentId)) return new Response("Factura no encontrada", { status: 404 });
  const payment = await getCompanyPayment(profile.companyId, paymentId);
  if (!payment || !hasInvoice(payment)) return new Response("Factura no encontrada", { status: 404 });
  return new Response(Buffer.from(buildInvoicePdf(payment)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceFilename(payment.invoiceNumber!)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
