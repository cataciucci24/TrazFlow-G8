import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const profile = await requireUserProfile();

  if (hasRole(profile, "warehouse_operator", "distributor_operator")) {
    const supabase = await createClient();
    let query = supabase.from("dispatch_orders").select("id, status, distributors ( name ), order_pallets ( validated_at )").order("created_at", { ascending: true });
    query = hasRole(profile, "warehouse_operator")
      ? query.eq("company_id", profile.companyId).in("status", ["draft", "validating", "has_discrepancy"])
      : query.eq("status", "confirmed");
    const { data: orders } = await query;

    const heading = hasRole(profile, "warehouse_operator") ? "Confirmar despacho" : "Confirmar recepción";
    const assignedOrders = (orders ?? []).filter((order) => (order.order_pallets ?? []).length > 0);
    return <div className="space-y-6"><div><h1 className="text-2xl font-bold">{heading}</h1><p className="mt-1 text-sm text-stone-500">Seleccioná una orden para validar los pallets mediante cámara o ingresando su código.</p></div>{assignedOrders.length > 0 ? <section><h2 className="mb-3 text-sm font-bold tracking-[0.08em] text-stone-500">ESTADO DE ÓRDENES</h2><div className="grid gap-4 lg:grid-cols-2">{assignedOrders.map((order) => { const distributor = Array.isArray(order.distributors) ? order.distributors[0] : order.distributors; const pallets = order.order_pallets ?? []; const validated = pallets.filter((pallet) => pallet.validated_at).length; return <Link key={order.id} href={`/dashboard/orders/${order.id}`} className="rounded-2xl border border-stone-200 bg-white p-5 transition hover:border-amber-300 hover:shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-mono font-bold">{order.id.slice(0, 8).toUpperCase()}</p><p className="mt-1 text-sm text-stone-500">{distributor?.name ?? "Distribuidor sin nombre"}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{order.status === "has_discrepancy" ? "Con diferencias" : "Pendiente"}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${pallets.length ? (validated / pallets.length) * 100 : 0}%` }} /></div><p className="mt-2 text-sm text-stone-500">{validated} de {pallets.length} pallets confirmados</p></Link>; })}</div></section> : <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center"><h2 className="text-xl font-bold">No hay órdenes pendientes</h2><p className="mt-2 text-sm text-stone-500">Cuando haya una orden lista para operar, aparecerá acá.</p></div>}</div>;
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
          <h2 className="text-lg font-semibold">Seguimiento de pallets</h2>
          <p className="mt-2 text-sm text-stone-500">
            Buscá y escaneá pallets por su código QR para consultar todo su historial de movimientos.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/traceability"
              className="inline-flex items-center text-sm font-semibold text-amber-600 group-hover:text-amber-700 transition-colors"
            >
              Ir al seguimiento &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
