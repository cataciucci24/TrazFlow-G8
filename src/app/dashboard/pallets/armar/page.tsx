import { redirect } from "next/navigation";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyLots } from "@/lib/pallets/queries";
import { getWarehouses } from "@/lib/warehouses/queries";
import { getErpStockOverview } from "@/lib/erp-stock/queries";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { MixedPalletForm } from "@/components/pallets/mixed-pallet-form";
import { PageHeader } from "@/components/ui/design-system";

export default async function BuildPalletPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager", "warehouse_operator")) redirect("/dashboard");
  const erp = await isErpEnabled(profile.companyId);
  const [lots, warehouses, erpLots] = await Promise.all([
    getCompanyLots(), getWarehouses(profile.companyId), erp ? getErpStockOverview() : undefined,
  ]);
  return <div className="app-page"><PageHeader title="Armar pallet" description="Uno o varios productos y lotes, identificados con un solo QR." />
    <MixedPalletForm lots={lots} warehouses={warehouses} erpLots={erpLots} />
  </div>;
}
