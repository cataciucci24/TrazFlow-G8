import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NewDispatchOrderForm } from "@/components/orders/new-dispatch-order-form";

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

  return (
    <div className="space-y-8">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/20 blur-3xl pointer-events-none" />
      <div className="absolute -right-32 top-1/2 h-96 w-96 rounded-full bg-red-950/15 blur-3xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Nueva orden de despacho
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Completá los datos requeridos para registrar la orden en el sistema.
          </p>
        </div>

        <div>
          <Link
            href="/dashboard/orders"
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white shadow-sm"
          >
            Volver
          </Link>
        </div>
      </div>

      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-8 shadow-xl backdrop-blur-md">
        <NewDispatchOrderForm distributors={data ?? []} />
      </div>
    </div>
  );
}
