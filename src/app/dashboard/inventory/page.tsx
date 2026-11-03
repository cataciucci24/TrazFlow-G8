import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InventoryPanel } from "@/components/inventory/inventory-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import { PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = {
  title: "Stock | TrazFlow",
};

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const [pallets, lots, existingProducts, erpManaged] = await Promise.all([
    getCompanyPallets(profile.companyId),
    getCompanyLots(),
    getCompanyProducts(profile.companyId),
    isErpEnabled(profile.companyId),
  ]);
  // Menú "⋯" de cada pallet: mismas acciones y reglas que en Pallets.
  const actions = {
    existingBatches: lots.map((lot) => ({ productSku: lot.productSku, batchNumber: lot.batchNumber })),
    existingProducts,
    erpManaged,
  };

  const params = await searchParams;

  return (
    <div className="app-page">
      <PageHeader title="Stock" description="Consultá los pallets de tu empresa por ubicación, producto y estado."
        action={<Link href="/dashboard/inventory/import" className="button-secondary">Importar desde Excel</Link>} />
      <InventoryPanel pallets={pallets} actions={actions} initialSearch={params.search ?? ""} />
    </div>
  );
}
