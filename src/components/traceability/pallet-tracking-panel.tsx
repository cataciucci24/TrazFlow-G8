"use client";

import Link from "next/link";
import { PalletQrButton } from "@/components/pallets/pallet-qr-button";
import { useMemo, useState } from "react";

import { PalletActions } from "@/components/pallets/pallet-actions";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { ExistingProduct, Pallet, ProductBatch } from "@/lib/types";
import { EmptyState, FilterPanel, CompactSummaryCard, PalletStatusBadge, SectionHeader, TableShell } from "@/components/ui/design-system";

// Las etiquetas salen de PALLET_STATUS_LABELS para que tarjetas, filtro y badges digan lo mismo.
const statusCards = [
  { value: "in_warehouse", tone: "sky" },
  { value: "assigned", tone: "violet" },
  { value: "in_transit", tone: "amber" },
  { value: "received", tone: "green" },
  { value: "discrepancy", tone: "red" },
] as const;


function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}
export function PalletTrackingPanel({
  pallets,
  existingBatches,
  existingProducts,
  initialStatus = "",
}: {
  pallets: Pallet[];
  existingBatches: ProductBatch[];
  existingProducts: ExistingProduct[];
  initialStatus?: string;
}) {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const locations = useMemo(() => Array.from(new Set(pallets.map((pallet) => pallet.currentLocation?.trim() || ""))).sort((a, b) => a.localeCompare(b, "es-AR")), [pallets]);
  const query = normalize(search.trim());
  const visiblePallets = pallets.filter((pallet) =>
    (!location || (pallet.currentLocation?.trim() || "") === location) &&
    (!status || pallet.status === status) &&
    (!query || [pallet.qrCode, pallet.productName, pallet.productSku, pallet.batchNumber].some((value) => normalize(value).includes(query))),
  );
  const hasFilters = Boolean(search || location || status);

  function clearFilters() {
    setSearch("");
    setLocation("");
    setStatus("");
  }

  return (
    <section className="space-y-10" aria-label="Seguimiento de pallets">
      <FilterPanel label="Filtros de pallets" onClear={hasFilters ? clearFilters : undefined}>
        <label className="form-label">Buscar
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Código QR, producto, SKU o lote" className="form-control mt-2" />
        </label>
        <label className="form-label">Ubicación
          <select value={location} onChange={(event) => setLocation(event.target.value)} className="form-control mt-2">
            <option value="">Todas las ubicaciones</option>
            {locations.map((value) => <option key={value || "none"} value={value}>{value || "Sin ubicación registrada"}</option>)}
          </select>
        </label>
        <label className="form-label">Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="form-control mt-2">
            <option value="">Todos los estados</option>
            {Object.entries(PALLET_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </FilterPanel>

      <section aria-label="Resumen de pallets por estado (tocá una tarjeta para filtrar)" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statusCards.map((card) => {
          const count = pallets.filter((pallet) => pallet.status === card.value).length;
          const isActive = status === card.value;
          return <CompactSummaryCard key={card.value} label={PALLET_STATUS_LABELS[card.value]} value={count} tone={card.tone} pressed={isActive} onClick={() => setStatus(isActive ? "" : card.value)} />;
        })}
      </section>

      <div className="section-stack">
        <SectionHeader
          title="Pallets registrados"
          action={<p role="status" className="text-sm text-stone-500">Mostrando {visiblePallets.length} de {pallets.length}</p>}
        />
        {visiblePallets.length === 0 ? <div className="surface"><EmptyState
          title={pallets.length === 0 ? "Todavía no hay pallets" : "Sin resultados para estos filtros"}
          description={pallets.length === 0 ? "Los pallets registrados para tu empresa aparecerán acá." : "Cambiá la búsqueda o los filtros para encontrar otros pallets."}
          action={pallets.length > 0 && hasFilters ? <button type="button" onClick={clearFilters} className="button-secondary">Limpiar filtros</button> : undefined}
        /></div> : <TableShell label="Pallets registrados" mobileLayout="rows">
          <table role="table" aria-label="Pallets registrados" className="data-table min-w-[780px]">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Código</th><th role="columnheader" scope="col">Producto</th><th role="columnheader" scope="col">Lote</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Ubicación</th><th role="columnheader" scope="col" className="text-right">Acciones</th></tr></thead>
            <tbody role="rowgroup">
              {visiblePallets.map((pallet) => <tr role="row" key={pallet.id}><td role="cell" data-label="Código" className="mobile-primary font-mono font-bold">{pallet.qrCode}</td><td role="cell" data-label="Producto" className="font-medium">{pallet.productName}</td><td role="cell" data-label="Lote" className="font-mono text-stone-600">{pallet.batchNumber}</td><td role="cell" data-label="Estado" className="mobile-priority"><PalletStatusBadge status={pallet.status} /></td><td role="cell" data-label="Ubicación" className="mobile-priority text-stone-500">{pallet.currentLocation ?? "—"}</td><td role="cell" data-label="Acciones" className="mobile-actions text-right"><div className="table-row-actions"><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="button-secondary button-sm">Ver trazabilidad</Link><PalletQrButton qrCode={pallet.qrCode} variant="compact" /><PalletActions pallet={pallet} existingBatches={existingBatches} existingProducts={existingProducts} /></div></td></tr>)}
            </tbody>
          </table>
        </TableShell>}
      </div>
    </section>
  );
}
