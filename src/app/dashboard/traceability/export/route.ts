import { canAccessDashboard } from "@/lib/auth/profile";
import { getUserProfile } from "@/lib/auth/session";
import { buildTimelineWorkbook } from "@/lib/traceability/export";
import { getLotTraceability, getPalletsTimeline, getPalletTraceability } from "@/lib/traceability/queries";

/**
 * TRZ-59: descarga en Excel la línea de tiempo de un pallet (?qr=) o de un lote (?lote=). Mismos permisos que
 * la pantalla: pallet para logística y depósito, lote solo para logística.
 */
export async function GET(request: Request) {
  const profile = await getUserProfile();
  if (!profile) return new Response("No autenticado", { status: 401 });
  if (!canAccessDashboard(profile)) return new Response("Sin permisos", { status: 403 });

  const params = new URL(request.url).searchParams;
  const qr = params.get("qr")?.trim();
  const lot = params.get("lote")?.trim();
  if ((!qr && !lot) || (qr ?? lot ?? "").length > 512) return new Response("Consulta inválida", { status: 400 });

  if (qr) {
    if (profile.role !== "logistics_manager" && profile.role !== "warehouse_operator") return new Response("Sin permisos", { status: 403 });
    const traceability = await getPalletTraceability(qr, profile.companyId);
    if (!traceability) return new Response("Pallet no encontrado", { status: 404 });
    const { pallet } = traceability;
    const entries = await getPalletsTimeline([pallet.id], profile.companyId);
    const file = await buildTimelineWorkbook(
      `Trazabilidad del pallet ${pallet.qrCode}`,
      [`Producto: ${pallet.productName} (${pallet.productSku})`, `Lote: ${pallet.batchNumber}`],
      entries,
    );
    return download(file, `trazabilidad-${pallet.qrCode}`);
  }

  if (profile.role !== "logistics_manager") return new Response("Sin permisos", { status: 403 });
  const lots = await getLotTraceability(lot!);
  if (lots.length === 0) return new Response("Lote no encontrado", { status: 404 });
  const palletIds = lots.flatMap((item) => item.pallets.map(({ pallet }) => pallet.id));
  const entries = await getPalletsTimeline(palletIds, profile.companyId);
  const file = await buildTimelineWorkbook(
    `Trazabilidad del lote ${lot}`,
    lots.map((item) => `Producto: ${item.productName} (${item.productSku}) · ${item.pallets.length} pallets`),
    entries,
  );
  return download(file, `trazabilidad-lote-${lot}`);
}

function download(file: ArrayBuffer, name: string) {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
  return new Response(Buffer.from(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
