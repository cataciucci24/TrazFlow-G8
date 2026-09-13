import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PalletTraceability } from "@/components/traceability/pallet-traceability";
import { TraceabilitySearch } from "@/components/traceability/traceability-search";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getPalletTraceability } from "@/lib/traceability/queries";
import { getCompanyPallets } from "@/lib/pallets/queries";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import { NewPalletForm } from "@/components/pallets/new-pallet-form";

export const metadata: Metadata = {
  title: "Consultar trazabilidad | TrazFlow",
};

export default async function TraceabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ qr?: string; status?: string }>;
}) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const qr = resolvedSearchParams?.qr;
  const selectedStatus = resolvedSearchParams?.status ?? "all";
  const rawQr = typeof qr === "string" ? qr : "";
  const normalizedQr = rawQr.trim();
  const isTooLong = normalizedQr.length > 512;
  const shouldSearch = normalizedQr.length > 0 && !isTooLong;
  const traceability = shouldSearch
    ? await getPalletTraceability(normalizedQr, profile.companyId)
    : null;
  const pallets = await getCompanyPallets(profile.companyId);
  const visiblePallets = pallets.filter((pallet) => selectedStatus === "all" || (selectedStatus === "warehouse" ? ["in_warehouse", "assigned"].includes(pallet.status) : selectedStatus === "dispatched" ? pallet.status === "in_transit" : pallet.status === "received"));
  const statusCount = (status: string) => pallets.filter((pallet) => pallet.status === status).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Consultar trazabilidad
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Buscá un pallet por su código QR.
          </p>
        </div>

        <NewPalletForm />
      </div>

      {/* Buscador directo sin contenedor duplicado */}
      <div>
        <TraceabilitySearch defaultQr={rawQr} />
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Seguimiento de pallets</h2>
          <p className="text-sm text-stone-500">{pallets.length} pallets registrados</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusCard label="En depósito" count={statusCount("in_warehouse") + statusCount("assigned")} color="bg-stone-500" />
          <StatusCard label="Despachado" count={statusCount("in_transit")} color="bg-amber-500" />
          <StatusCard label="Entregado" count={statusCount("received")} color="bg-emerald-600" />
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Filtrar pallets por estado">
          <Filter href="/dashboard/traceability" active={selectedStatus === "all"}>Todos</Filter>
          <Filter href="/dashboard/traceability?status=warehouse" active={selectedStatus === "warehouse"}>En depósito</Filter>
          <Filter href="/dashboard/traceability?status=dispatched" active={selectedStatus === "dispatched"}>Despachado</Filter>
          <Filter href="/dashboard/traceability?status=delivered" active={selectedStatus === "delivered"}>Entregado</Filter>
        </nav>
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="bg-stone-100/80 text-stone-500"><th className="px-5 py-4 font-semibold">Código</th><th className="px-5 py-4 font-semibold">Producto</th><th className="px-5 py-4 font-semibold">Lote</th><th className="px-5 py-4 font-semibold">Estado</th><th className="px-5 py-4 font-semibold">Ubicación</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {visiblePallets.map((pallet) => <tr key={pallet.id} className="hover:bg-amber-50/40"><td className="px-5 py-4 font-mono font-bold">{pallet.qrCode}</td><td className="px-5 py-4 font-medium">{pallet.productName}</td><td className="px-5 py-4 font-mono text-stone-600">{pallet.batchNumber}</td><td className="px-5 py-4"><PalletStatus status={pallet.status} label={PALLET_STATUS_LABELS[pallet.status]} /></td><td className="px-5 py-4 text-stone-500">{pallet.currentLocation ?? "—"}</td></tr>)}
              {visiblePallets.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-stone-500">No hay pallets para este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Alertas de errores o validaciones */}
      {isTooLong && (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          El código QR no puede superar los 512 caracteres.
        </p>
      )}


      {shouldSearch && !traceability && (
        <p
          role="status"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
        >
          No se encontró ningún pallet con ese código QR.
        </p>
      )}

      {traceability && <PalletTraceability traceability={traceability} />}
    </div>
  );
}

function StatusCard({ label, count, color }: { label: string; count: number; color: string }) {
  return <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-5"><span className={`grid size-10 place-items-center rounded-xl ${color} bg-opacity-10`}><span className={`size-3 rounded-full ${color}`} /></span><div><p className="text-2xl font-bold">{count}</p><p className="text-sm text-stone-500">{label}</p></div></div>;
}

function PalletStatus({ status, label }: { status: string; label: string }) {
  const classes = status === "received" ? "bg-emerald-50 text-emerald-600" : status === "in_transit" ? "bg-amber-50 text-amber-600" : status === "discrepancy" ? "bg-red-50 text-red-600" : "bg-stone-100 text-stone-600";
  return <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}>{label}</span>;
}

function Filter({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${active ? "border-amber-500 bg-amber-500 text-white" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"}`}>{children}</Link>;
}
