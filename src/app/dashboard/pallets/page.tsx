import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewPalletForm } from "@/components/pallets/new-pallet-form";
import { PalletTrackingPanel } from "@/components/traceability/pallet-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import type { ProductBatch } from "@/lib/types";
import { PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Pallets | TrazFlow" };

export default async function PalletsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [pallets, products] = await Promise.all([getCompanyPallets(profile.companyId), getCompanyProducts(profile.companyId)]);
  const existingBatches: ProductBatch[] = Array.from(new Map(pallets.map((pallet) => [`${pallet.productSku} ${pallet.batchNumber}`, { productSku: pallet.productSku, batchNumber: pallet.batchNumber }])).values());

  return <div className="app-page"><PageHeader title="Pallets" description="Consultá, registrá y realizá el seguimiento de tus pallets." action={<NewPalletForm existingBatches={existingBatches} existingProducts={products} />} /><PalletTrackingPanel pallets={pallets} existingBatches={existingBatches} existingProducts={products} /></div>;
}
