import { getUserProfile } from "@/lib/auth/session";
import { canAccessDashboard } from "@/lib/auth/profile";
import { buildImportTemplate } from "@/lib/stock-import/xlsx";

export async function GET() {
  const profile = await getUserProfile();
  if (!profile) return new Response("No autenticado", { status: 401 });
  if (!canAccessDashboard(profile) || profile.role !== "logistics_manager") return new Response("Sin permisos", { status: 403 });
  return new Response(Buffer.from(await buildImportTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-stock-trazflow.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
