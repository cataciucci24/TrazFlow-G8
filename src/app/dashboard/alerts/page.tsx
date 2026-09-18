import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExpirationAlerts, ExpirationAlertSummary } from "@/components/dashboard/expiration-alerts";
import { StockAlerts } from "@/components/dashboard/stock-alerts";
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
    <div className="space-y-8">
      <div className="border-b border-stone-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Alertas</h1>
        <p className="mt-1 text-sm text-stone-500">Anticipá quiebres de stock y priorizá la distribución de mercadería próxima a vencer.</p>
      </div>

      <section aria-labelledby="urgency-summary-title" className="space-y-4">
        <div>
          <h2 id="urgency-summary-title" className="text-xl font-bold">Resumen por urgencia</h2>
          <p className="mt-1 text-sm text-stone-500">Alertas generadas para vencimientos dentro de los próximos 90 días.</p>
        </div>
        <ExpirationAlertSummary alerts={expirationAlerts} />
      </section>

      <StockAlerts {...stockAlerts} />

      <ExpirationAlerts alerts={expirationAlerts} />
    </div>
  );
}
