import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NewDispatchOrderForm } from "@/components/orders/new-dispatch-order-form";
import { getAvailablePallets } from "@/lib/pallets/queries";
import { InlineAlert, PageHeader } from "@/components/ui/design-system";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { canCreateManualOrders, ERP_ORDERS_NOTICE } from "@/lib/orders/erp-policy";

export const metadata: Metadata = {
  title: "Nueva orden de despacho | TrazFlow",
};

export default async function NewDispatchOrderPage() {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  // Con ERP, las órdenes solo entran por la sincronización (TRZ-102): se explica en lugar del formulario.
  if (!canCreateManualOrders(await isErpEnabled(profile.companyId))) {
    return (
      <div className="app-page">
        <PageHeader title="Nueva orden de despacho" description="Las órdenes de tu empresa vienen del ERP." action={<Link href="/dashboard/orders" className="button-secondary">Volver</Link>} />
        <InlineAlert announce={false}>{ERP_ORDERS_NOTICE}</InlineAlert>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("distributors")
    .select("id, name")
    .eq("company_id", profile.companyId)
    .order("name");

  if (error) {
    throw new Error(
      `No se pudieron leer los distribuidores (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  const pallets = await getAvailablePallets(profile.companyId);

  return (
    <div className="app-page">
      <PageHeader title="Nueva orden de despacho" description="Completá los datos requeridos para registrar la orden en el sistema." action={<Link href="/dashboard/orders" className="button-secondary">Volver</Link>} />

      <div className="surface p-5 sm:p-8">
        <NewDispatchOrderForm distributors={data ?? []} pallets={pallets} />
      </div>
    </div>
  );
}
