import { requireUserProfile } from "@/lib/auth/session";
import Link from "next/link";

export default async function DashboardPage() {
  await requireUserProfile();

  return (
    <div className="space-y-8">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/20 blur-3xl pointer-events-none" />
      <div className="absolute -right-32 top-1/2 h-96 w-96 rounded-full bg-red-950/15 blur-3xl pointer-events-none" />

      <div className="border-b border-zinc-800/80 pb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          Panel de Control
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Seleccioná una opción para comenzar a operar en el sistema.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="group relative rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 shadow-xl backdrop-blur-md transition-all hover:border-red-950/50">
          <h2 className="text-lg font-semibold text-white">Órdenes de Despacho</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Gestioná, asociá pallets y confirmá los despachos de mercadería de forma rápida y ordenada.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center text-sm font-medium text-red-400 group-hover:text-red-300 transition-colors"
            >
              Ver órdenes &rarr;
            </Link>
          </div>
        </div>

        <div className="group relative rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-6 shadow-xl backdrop-blur-md transition-all hover:border-red-950/50">
          <h2 className="text-lg font-semibold text-white">Consultar Trazabilidad</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Buscá y escaneá pallets por su código QR para consultar todo su historial de movimientos.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/traceability"
              className="inline-flex items-center text-sm font-medium text-red-400 group-hover:text-red-300 transition-colors"
            >
              Ir a trazabilidad &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
