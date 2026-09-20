import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getStalePallets } from "@/lib/pallets/queries";
import type { PalletStatus } from "@/lib/types";
import { PageHeader, PalletStatusBadge, SectionHeader, SummaryCard, TableShell } from "@/components/ui/design-system";

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
    <div className="app-page">
      <PageHeader eyebrow="Decisiones de inventario" title="Mercadería inmovilizada" description="Detectá pallets sin actividad reciente para decidir su redistribución o comercialización." action={<Link href="/dashboard/traceability" className="button-secondary">Ver trazabilidad</Link>} />

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="PALLETS INMOVILIZADOS" value={String(visiblePallets.length)} />
        <SummaryCard label="UNIDADES INVOLUCRADAS" value={String(totalQuantity)} />
        <SummaryCard label="UMBRAL ACTUAL" value={`${thresholdDays} días`} />
      </section>

      <section className="section-stack">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionHeader title="Pallets para revisar" description="Se toma como actividad la fecha del último movimiento o el alta del pallet." />
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

        <TableShell label="Pallets inmovilizados">
          <table className="data-table min-w-[820px]">
            <thead><tr className="bg-stone-100/80 text-stone-500"><th className="px-5 py-4 font-semibold">Pallet</th><th className="px-5 py-4 font-semibold">Mercadería</th><th className="px-5 py-4 font-semibold">Lote</th><th className="px-5 py-4 font-semibold">Estado</th><th className="px-5 py-4 font-semibold">Ubicación</th><th className="px-5 py-4 text-right font-semibold">Sin movimiento</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {visiblePallets.map((pallet) => (
                <tr key={pallet.id} className="hover:bg-[var(--brand-soft)]">
                  <td className="px-5 py-4"><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="table-action font-mono">{pallet.qrCode}</Link></td>
                  <td className="px-5 py-4"><p className="font-semibold">{pallet.productName}</p><p className="text-xs text-stone-500">SKU {pallet.productSku} · {pallet.quantity ?? 0} unidades</p></td>
                  <td className="px-5 py-4 font-mono text-stone-600">{pallet.batchNumber}</td>
                  <td className="px-5 py-4"><PalletStatusBadge status={pallet.status} /></td>
                  <td className="px-5 py-4 text-stone-500">{pallet.currentLocation ?? "Sin ubicación"}</td>
                  <td className="px-5 py-4 text-right"><span className="font-bold text-red-700">{pallet.daysWithoutMovement} días</span><p className="text-xs text-stone-500">{pallet.lastMovementAt ? "desde último movimiento" : "desde alta"}</p></td>
                </tr>
              ))}
              {visiblePallets.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-stone-500">No hay mercadería que supere este umbral con el filtro elegido.</td></tr>}
            </tbody>
          </table>
        </TableShell>
      </section>
    </div>
  );
}

function FilterLink({ days, status, active, children }: { days: number; status: "all" | PalletStatus; active: boolean; children: React.ReactNode }) {
  const query = new URLSearchParams();
  query.set("days", String(days));
  if (status !== "all") query.set("status", status);
  return <Link href={`/dashboard/stagnant?${query.toString()}`} className={`filter-chip ${active ? "filter-chip-active" : ""}`}>{children}</Link>;
}
