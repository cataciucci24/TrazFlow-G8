import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AlertsCenter } from "@/components/dashboard/alerts-center";
import { PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getExpirationAlerts } from "@/lib/pallets/queries";
import { getDistributorStockAlerts } from "@/lib/stock-alerts/queries";

export const metadata: Metadata = {
  title: "Alertas | TrazFlow",
};

export default async function AlertsPage() {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const [expirationAlerts, stockAlerts] = await Promise.all([
    getExpirationAlerts(profile.companyId),
    getDistributorStockAlerts(profile.companyId),
  ]);

  return (
    <div className="app-page">
      <PageHeader
        title="Alertas"
        description="Anticipá problemas de stock y vencimientos antes de que afecten la distribución."
      />
      <AlertsCenter
        expirationAlerts={expirationAlerts}
        stockAlerts={stockAlerts.alerts}
        inventorySourceAvailable={stockAlerts.inventorySourceAvailable}
      />
    </div>
  );
}
