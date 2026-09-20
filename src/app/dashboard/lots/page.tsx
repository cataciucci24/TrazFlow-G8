import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewLotForm } from "@/components/pallets/new-lot-form";
import { LotTrackingPanel } from "@/components/traceability/lot-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";

export const metadata: Metadata = { title: "Lotes | TrazFlow" };

export default async function LotsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [lots, pallets, products] = await Promise.all([getCompanyLots(), getCompanyPallets(profile.companyId), getCompanyProducts(profile.companyId)]);

  return <div className="space-y-8"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6"><div><h1 className="text-2xl font-bold tracking-tight">Lotes</h1><p className="mt-1 text-sm text-stone-500">Consultá, registrá y realizá el seguimiento de tus lotes.</p></div><NewLotForm existingProducts={products} /></div><LotTrackingPanel lots={lots} pallets={pallets} /></div>;
}
