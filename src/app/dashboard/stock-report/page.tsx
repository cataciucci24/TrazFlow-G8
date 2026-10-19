import { redirect } from "next/navigation";

import { requireUserProfile } from "@/lib/auth/session";

/** La carga de stock del destinatario quedó fuera del nuevo modelo ERP. */
export default async function StockReportPage() {
  await requireUserProfile();
  redirect("/dashboard");
}
