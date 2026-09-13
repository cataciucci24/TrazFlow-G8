import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardPage() {
  const profile = await requireUserProfile();

  if (hasRole(profile, "warehouse_operator", "distributor_operator")) {
    const supabase = await createClient();
    let query = supabase.from("dispatch_orders").select("id").order("created_at", { ascending: true });
    query = hasRole(profile, "warehouse_operator")
      ? query.eq("company_id", profile.companyId).in("status", ["draft", "validating", "has_discrepancy"])
      : query.eq("status", "confirmed");
    const { data } = await query.limit(1);
    if (data?.[0]) redirect(`/dashboard/orders/${data[0].id}`);

    return <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center"><h1 className="text-xl font-bold">No hay órdenes pendientes</h1><p className="mt-2 text-sm text-stone-500">Cuando haya una orden lista para operar, aparecerá acá.</p></div>;
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-stone-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Panel de Control
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Seleccioná una opción para comenzar a operar en el sistema.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="group rounded-2xl border border-stone-200 bg-white p-6 transition-colors hover:border-amber-300">
          <h2 className="text-lg font-semibold">Órdenes de Despacho</h2>
          <p className="mt-2 text-sm text-stone-500">
            Gestioná, asociá pallets y confirmá los despachos de mercadería de forma rápida y ordenada.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center text-sm font-semibold text-amber-600 group-hover:text-amber-700 transition-colors"
            >
              Ver órdenes &rarr;
            </Link>
          </div>
        </div>

        <div className="group rounded-2xl border border-stone-200 bg-white p-6 transition-colors hover:border-amber-300">
          <h2 className="text-lg font-semibold">Consultar Trazabilidad</h2>
          <p className="mt-2 text-sm text-stone-500">
            Buscá y escaneá pallets por su código QR para consultar todo su historial de movimientos.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/traceability"
              className="inline-flex items-center text-sm font-semibold text-amber-600 group-hover:text-amber-700 transition-colors"
            >
              Ir a trazabilidad &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
