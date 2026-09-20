import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewLotForm } from "@/components/pallets/new-lot-form";
import { LotTrackingPanel } from "@/components/traceability/lot-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import { PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Lotes | TrazFlow" };

export default async function LotsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [lots, pallets, products] = await Promise.all([getCompanyLots(), getCompanyPallets(profile.companyId), getCompanyProducts(profile.companyId)]);

  return <div className="app-page"><PageHeader title="Lotes" description="Consultá, registrá y realizá el seguimiento de tus lotes." action={<NewLotForm existingProducts={products} />} /><LotTrackingPanel lots={lots} pallets={pallets} /></div>;
}
