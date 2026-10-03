import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getStalePallets } from "@/lib/pallets/queries";
import { getRedistributionSuggestions } from "@/lib/redistribution/queries";
import type { PalletStatus } from "@/lib/types";
import { EmptyState, PageHeader, PalletStatusBadge, SectionHeader, SummaryCard, TableShell } from "@/components/ui/design-system";
import { RedistributionSuggestions } from "@/components/stagnant/redistribution-suggestions";

export const metadata: Metadata = {
  title: "Mercadería inmovilizada | TrazFlow",
};

const THRESHOLDS = [7, 15, 30, 60, 90];
const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
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
  const redistribution = await getRedistributionSuggestions(profile.companyId, stalePallets);
  const visiblePallets = stalePallets.filter(
    (pallet) => selectedStatus === "all" || pallet.status === selectedStatus,
  );
  const totalsByUnit = new Map<string, number>();
  for (const pallet of visiblePallets) {
    if (pallet.quantity === null || pallet.unitOfMeasure === null) continue;
    totalsByUnit.set(pallet.unitOfMeasure, (totalsByUnit.get(pallet.unitOfMeasure) ?? 0) + pallet.quantity);
  }
  const totalQuantityLabel = totalsByUnit.size === 0
    ? "—"
    : [...totalsByUnit].map(([unit, total]) => `${NUMBER_FORMATTER.format(total)} ${unit}`).join(" · ");

  return (
    <div className="app-page">
      <PageHeader eyebrow="Decisiones de inventario" title="Mercadería inmovilizada" description="Detectá pallets sin actividad reciente para decidir su redistribución o comercialización." action={<Link href="/dashboard/traceability" className="button-secondary">Ver trazabilidad</Link>} />

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="PALLETS INMOVILIZADOS" value={String(visiblePallets.length)} />
        <SummaryCard label="CANTIDAD INVOLUCRADA" value={totalQuantityLabel} />
        <SummaryCard label="UMBRAL ACTUAL" value={`${thresholdDays} días`} />
      </section>

      <RedistributionSuggestions suggestions={redistribution.suggestions} stockSourceAvailable={redistribution.stockSourceAvailable} />

      <section className="section-stack">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionHeader title="Pallets para revisar" description="Se toma como actividad la fecha del último movimiento o el alta del pallet." />
          </div>
          <nav className="filter-group" aria-label="Elegir umbral de inmovilidad">
            {THRESHOLDS.map((days) => (
              <FilterLink key={days} days={days} status={selectedStatus} active={days === thresholdDays}>
                {days} días
              </FilterLink>
            ))}
          </nav>
        </div>

        <nav className="filter-group" aria-label="Filtrar mercadería por estado">
          {STATUS_FILTERS.map((filter) => (
            <FilterLink key={filter.value} days={thresholdDays} status={filter.value} active={filter.value === selectedStatus}>
              {filter.label}
            </FilterLink>
          ))}
        </nav>

        {visiblePallets.length === 0 ? <div className="surface"><EmptyState
          title={stalePallets.length === 0 ? "Sin pallets inmovilizados para este umbral" : "Sin resultados para este estado"}
          description={stalePallets.length === 0 ? `No hay pallets que superen ${thresholdDays} días sin actividad. Podés revisar otro umbral.` : "Hay pallets inmovilizados en otros estados. Revisá el filtro seleccionado."}
          action={stalePallets.length > 0 ? <Link href={`/dashboard/stagnant?days=${thresholdDays}`} className="button-secondary">Ver todos los estados</Link> : undefined}
        /></div> : <TableShell label="Pallets inmovilizados">
          <table className="data-table min-w-[640px]">
            <thead><tr><th scope="col">Pallet</th><th scope="col">Mercadería</th><th scope="col" className="table-secondary-column">Lote</th><th scope="col">Estado</th><th scope="col">Ubicación</th><th scope="col" className="text-right">Sin movimiento</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {visiblePallets.map((pallet) => (
                <tr key={pallet.id}>
                  <td><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="table-action font-mono">{pallet.qrCode}</Link></td>
                  <td><p className="font-semibold">{pallet.productName}</p><p className="text-xs text-stone-500">SKU {pallet.productSku}<span className="md:hidden"> · Lote {pallet.batchNumber}</span> · {pallet.quantity !== null ? `${NUMBER_FORMATTER.format(pallet.quantity)} ${pallet.unitOfMeasure}` : "cantidad sin definir"}</p></td>
                  <td className="table-secondary-column font-mono text-stone-600">{pallet.batchNumber}</td>
                  <td><PalletStatusBadge status={pallet.status} /></td>
                  <td className="text-stone-500">{pallet.currentLocation ?? "Sin ubicación"}</td>
                  <td className="text-right"><span className="font-bold text-red-700">{pallet.daysWithoutMovement} días</span><p className="text-xs text-stone-500">{pallet.lastMovementAt ? "desde último movimiento" : "desde alta"}</p></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>}
      </section>
    </div>
  );
}

function FilterLink({ days, status, active, children }: { days: number; status: "all" | PalletStatus; active: boolean; children: React.ReactNode }) {
  const query = new URLSearchParams();
  query.set("days", String(days));
  if (status !== "all") query.set("status", status);
  return <Link href={`/dashboard/stagnant?${query.toString()}`} aria-current={active ? "true" : undefined} className={`filter-chip ${active ? "filter-chip-active" : ""}`}>{children}</Link>;
}
