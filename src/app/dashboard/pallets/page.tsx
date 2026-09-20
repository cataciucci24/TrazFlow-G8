import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewPalletForm } from "@/components/pallets/new-pallet-form";
import { PalletTrackingPanel } from "@/components/traceability/pallet-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import type { ProductBatch } from "@/lib/types";
import { PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Pallets | TrazFlow" };

export default async function PalletsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [pallets, lots, products] = await Promise.all([getCompanyPallets(profile.companyId), getCompanyLots(), getCompanyProducts(profile.companyId)]);
  const existingBatches: ProductBatch[] = lots.map((lot) => ({ productSku: lot.productSku, batchNumber: lot.batchNumber }));

  return <div className="app-page"><PageHeader title="Pallets" description="Consultá, registrá y realizá el seguimiento de tus pallets." action={<NewPalletForm existingBatches={existingBatches} existingProducts={products} />} /><PalletTrackingPanel pallets={pallets} existingBatches={existingBatches} existingProducts={products} /></div>;
}
