import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NewDispatchOrderForm } from "@/components/orders/new-dispatch-order-form";
import { getAvailablePallets } from "@/lib/pallets/queries";

export const metadata: Metadata = {
  title: "Nueva orden de despacho | TrazFlow",
};

export default async function NewDispatchOrderPage() {
  const profile = await requireUserProfile();

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

  const pallets = await getAvailablePallets(profile.companyId);

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Nueva orden de despacho
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Completá los datos requeridos para registrar la orden en el sistema.
          </p>
        </div>

        <div>
          <Link
            href="/dashboard/orders"
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
          >
            Volver
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8">
        <NewDispatchOrderForm distributors={data ?? []} pallets={pallets} />
      </div>
    </div>
  );
}
