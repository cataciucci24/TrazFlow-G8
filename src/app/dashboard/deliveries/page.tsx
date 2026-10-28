import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState, OperationCard, OperationProgress, OrderStatusBadge, PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getAssignedDeliveries } from "@/lib/deliveries/queries";

export const metadata: Metadata = { title: "Mis entregas | TrazFlow" };

export default async function DeliveriesPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "driver_operator")) redirect("/dashboard");
  const deliveries = await getAssignedDeliveries(profile.id);
  return <div className="app-page">
    <PageHeader title="Mis entregas" description="Órdenes en tránsito asignadas a tu usuario." />
    {deliveries.length === 0 ? <div className="surface"><EmptyState title="No tenés entregas asignadas" description="Cuando logística te asigne una orden en tránsito, aparecerá acá." /></div> :
      <div className="grid gap-4 lg:grid-cols-2">{deliveries.map((delivery) =>
        <Link key={delivery.id} href={`/dashboard/deliveries/${delivery.id}`} className="surface operation-card">
          <OperationCard code={delivery.id.slice(0, 8).toUpperCase()} title={delivery.recipientName} status={<OrderStatusBadge status={delivery.status} />}>
            <OperationProgress completed={delivery.processedCount} total={delivery.palletCount} label="pallets procesados" />
          </OperationCard>
          <p className="mt-1 text-xs text-stone-500">Despacho estimado: {delivery.estimatedDispatchDate}</p>
        </Link>)}</div>}
  </div>;
}
