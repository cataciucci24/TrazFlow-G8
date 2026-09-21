import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InventoryPanel } from "@/components/inventory/inventory-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPallets } from "@/lib/pallets/queries";
import { PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = {
  title: "Stock | TrazFlow",
};

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const pallets = await getCompanyPallets(profile.companyId);

  const params = await searchParams;

  return (
    <div className="app-page">
      <PageHeader title="Stock" description="Consultá los pallets de tu empresa por ubicación, producto y estado." />
      <InventoryPanel pallets={pallets} initialSearch={params.search ?? ""} />
    </div>
  );
}
