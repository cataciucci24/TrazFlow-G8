import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewPalletForm } from "@/components/pallets/new-pallet-form";
import { PalletTrackingPanel } from "@/components/traceability/pallet-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import type { ProductBatch } from "@/lib/types";

export const metadata: Metadata = { title: "Pallets | TrazFlow" };

export default async function PalletsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [pallets, products] = await Promise.all([getCompanyPallets(profile.companyId), getCompanyProducts(profile.companyId)]);
  const existingBatches: ProductBatch[] = Array.from(new Map(pallets.map((pallet) => [`${pallet.productSku} ${pallet.batchNumber}`, { productSku: pallet.productSku, batchNumber: pallet.batchNumber }])).values());

  return <div className="space-y-8"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6"><div><h1 className="text-2xl font-bold tracking-tight">Pallets</h1><p className="mt-1 text-sm text-stone-500">Consultá, registrá y realizá el seguimiento de tus pallets.</p></div><NewPalletForm existingBatches={existingBatches} existingProducts={products} /></div><PalletTrackingPanel pallets={pallets} existingBatches={existingBatches} existingProducts={products} /></div>;
}
