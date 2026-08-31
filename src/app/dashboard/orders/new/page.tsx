import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Distributor } from "@/lib/types";
import { NewDispatchOrderForm } from "@/components/orders/new-dispatch-order-form";

export const metadata: Metadata = {
  title: "Nueva orden de despacho | TrazFlow",
};

export default async function NewDispatchOrderPage() {
  const profile = await requireUserProfile();

  // Solo el responsable logístico puede crear órdenes (mismo criterio que la
  // policy `orders_insert` en Postgres).
  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
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

  const distributors: Distributor[] = data ?? [];

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">
        Nueva orden de despacho
      </h1>

      <NewDispatchOrderForm distributors={distributors} />
    </section>
  );
}
