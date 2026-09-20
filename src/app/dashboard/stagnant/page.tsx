import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getStalePallets } from "@/lib/pallets/queries";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { PalletStatus } from "@/lib/types";

export const metadata: Metadata = {
  title: "Mercadería inmovilizada | TrazFlow",
};

const THRESHOLDS = [7, 15, 30, 60, 90];
const STATUS_FILTERS: Array<{ value: "all" | PalletStatus; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "in_warehouse", label: "En depósito" },
  { value: "assigned", label: "Asignados" },
  { value: "in_transit", label: "En tránsito" },
  { value: "received", label: "Recibidos" },
];

export default async function StagnantInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; status?: string }>;
}) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const requestedDays = Number(params.days);
  const thresholdDays = THRESHOLDS.includes(requestedDays) ? requestedDays : 30;
  const selectedStatus = STATUS_FILTERS.some((filter) => filter.value === params.status)
    ? (params.status as "all" | PalletStatus)
    : "all";
  const stalePallets = await getStalePallets(profile.companyId, thresholdDays);
  const visiblePallets = stalePallets.filter(
    (pallet) => selectedStatus === "all" || pallet.status === selectedStatus,
  );
  const totalQuantity = visiblePallets.reduce((total, pallet) => total + (pallet.quantity ?? 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-amber-600">Decisiones de inventario</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Mercadería inmovilizada</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">
            Detectá pallets sin actividad reciente para decidir su redistribución o comercialización.
          </p>
        </div>
        <Link href="/dashboard/traceability" className="text-sm font-semibold text-amber-600 hover:text-amber-700">
          Ver trazabilidad completa &rarr;
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Pallets inmovilizados" value={String(visiblePallets.length)} />
        <SummaryCard label="Unidades involucradas" value={String(totalQuantity)} />
        <SummaryCard label="Umbral actual" value={`${thresholdDays} días`} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">Pallets para revisar</h2>
            <p className="text-sm text-stone-500">Se toma como actividad la fecha del último movimiento o el alta del pallet.</p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Elegir umbral de inmovilidad">
            {THRESHOLDS.map((days) => (
              <FilterLink key={days} days={days} status={selectedStatus} active={days === thresholdDays}>
                {days} días
              </FilterLink>
            ))}
          </nav>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Filtrar mercadería por estado">
          {STATUS_FILTERS.map((filter) => (
            <FilterLink key={filter.value} days={thresholdDays} status={filter.value} active={filter.value === selectedStatus}>
              {filter.label}
            </FilterLink>
          ))}
        </nav>

        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="bg-stone-100/80 text-stone-500"><th className="px-5 py-4 font-semibold">Pallet</th><th className="px-5 py-4 font-semibold">Mercadería</th><th className="px-5 py-4 font-semibold">Lote</th><th className="px-5 py-4 font-semibold">Estado</th><th className="px-5 py-4 font-semibold">Ubicación</th><th className="px-5 py-4 text-right font-semibold">Sin movimiento</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {visiblePallets.map((pallet) => (
                <tr key={pallet.id} className="hover:bg-amber-50/40">
                  <td className="px-5 py-4"><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="font-mono font-bold hover:text-amber-600">{pallet.qrCode}</Link></td>
                  <td className="px-5 py-4"><p className="font-semibold">{pallet.productName}</p><p className="text-xs text-stone-500">SKU {pallet.productSku} · {pallet.quantity ?? 0} unidades</p></td>
                  <td className="px-5 py-4 font-mono text-stone-600">{pallet.batchNumber}</td>
                  <td className="px-5 py-4"><StatusBadge status={pallet.status} /></td>
                  <td className="px-5 py-4 text-stone-500">{pallet.currentLocation ?? "Sin ubicación"}</td>
                  <td className="px-5 py-4 text-right"><span className="font-bold text-red-700">{pallet.daysWithoutMovement} días</span><p className="text-xs text-stone-500">{pallet.lastMovementAt ? "desde último movimiento" : "desde alta"}</p></td>
                </tr>
              ))}
              {visiblePallets.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-stone-500">No hay mercadería que supere este umbral con el filtro elegido.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-3xl font-bold tracking-tight">{value}</p><p className="mt-1 text-sm text-stone-500">{label}</p></div>;
}

function StatusBadge({ status }: { status: PalletStatus }) {
  const classes = status === "received" ? "bg-emerald-50 text-emerald-700" : status === "in_transit" ? "bg-amber-50 text-amber-700" : status === "assigned" ? "bg-violet-50 text-violet-700" : status === "in_warehouse" ? "bg-sky-50 text-sky-700" : "bg-red-50 text-red-700";
  return <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}>{PALLET_STATUS_LABELS[status]}</span>;
}

function FilterLink({ days, status, active, children }: { days: number; status: "all" | PalletStatus; active: boolean; children: React.ReactNode }) {
  const query = new URLSearchParams();
  query.set("days", String(days));
  if (status !== "all") query.set("status", status);
  return <Link href={`/dashboard/stagnant?${query.toString()}`} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${active ? "border-amber-500 bg-amber-500 text-white" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"}`}>{children}</Link>;
}