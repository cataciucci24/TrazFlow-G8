import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DeliveryPanel } from "@/components/deliveries/delivery-panel";
import { PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getOrderDeliveryPallets } from "@/lib/deliveries/queries";
import { getDispatchOrderDetail } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Detalle de entrega | TrazFlow" };

export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "driver_operator")) redirect("/dashboard");
  const { id } = await params;
  const [order, pallets] = await Promise.all([getDispatchOrderDetail(id), getOrderDeliveryPallets(id)]);
  if (!order || order.driverId !== profile.id) notFound();
  return <div className="app-page">
    <PageHeader title="Confirmar entrega" description={`Destinatario: ${order.distributorName}`} action={<Link href="/dashboard/deliveries" className="button-secondary">Volver</Link>} />
    <DeliveryPanel orderId={order.id} pallets={pallets} canDeliver={order.status === "confirmed"} />
  </div>;
}
