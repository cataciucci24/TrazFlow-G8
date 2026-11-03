import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StockImportPanel } from "@/components/stock-import/stock-import-panel";
import { PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";

export const metadata: Metadata = { title: "Importar stock | TrazFlow" };

export default async function StockImportPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const erp = await isErpEnabled(profile.companyId);
  return <div className="app-page">
    <PageHeader title="Importar stock" description={erp
      ? "Subí productos, lotes y stock desde una planilla. Se envían al ERP y entran a TrazFlow con la sincronización."
      : "Subí productos, lotes y stock desde una planilla. Cada fila queda como un pallet en depósito."}
      action={<Link href="/dashboard/inventory" className="button-secondary">Volver a stock</Link>} />
    <StockImportPanel />
  </div>;
}
