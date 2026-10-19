import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewLotForm } from "@/components/pallets/new-lot-form";
import { LotTrackingPanel } from "@/components/traceability/lot-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getExpirationThresholds } from "@/lib/expiration/queries";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import { PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Lotes | TrazFlow" };

export default async function LotsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const erpEnabled = await isErpEnabled(profile.companyId);
  const [lots, pallets, products, thresholds] = await Promise.all([getCompanyLots(), getCompanyPallets(profile.companyId), getCompanyProducts(profile.companyId), getExpirationThresholds()]);

  // Con ERP, productos y lotes se dan de alta en el ERP: esta pantalla queda de consulta.
  return <div className="app-page"><PageHeader title="Lotes"
    description={erpEnabled ? "Consultá y seguí los lotes importados del ERP. Se sincronizan desde Pallets u Órdenes." : "Consultá, registrá y realizá el seguimiento de tus lotes."}
    action={erpEnabled ? undefined : <NewLotForm existingProducts={products} />} /><LotTrackingPanel lots={lots} pallets={pallets} thresholds={thresholds} /></div>;
}
