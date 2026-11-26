import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/design-system";
import { WarehousesPanel } from "@/components/warehouses/warehouses-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getWarehouses, getWarehouseLocationCounts } from "@/lib/warehouses/queries";

export const metadata = { title: "Depósitos | TrazFlow" };

export default async function WarehousesPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [warehouses, erpEnabled] = await Promise.all([getWarehouses(profile.companyId), isErpEnabled(profile.companyId)]);
  const counts = await getWarehouseLocationCounts(profile.companyId, warehouses);
  return <div className="app-page"><PageHeader title="Depósitos" description="Administrá los depósitos de tu empresa." /><WarehousesPanel warehouses={warehouses} counts={counts} erpEnabled={erpEnabled} /></div>;
}
