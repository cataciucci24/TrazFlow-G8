import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InventoryPanel } from "@/components/inventory/inventory-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPallets } from "@/lib/pallets/queries";

export const metadata: Metadata = {
  title: "Stock | TrazFlow",
};

export default async function InventoryPage() {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const pallets = await getCompanyPallets(profile.companyId);

  return (
    <div className="space-y-8">
      <div className="border-b border-stone-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Stock</h1>
        <p className="mt-1 text-sm text-stone-500">
          Consultá los pallets de tu empresa por ubicación, producto y estado.
        </p>
      </div>
      <InventoryPanel pallets={pallets} />
    </div>
  );
}
