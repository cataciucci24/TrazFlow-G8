"use client";

import { useMemo, useState } from "react";

import { LotsTable } from "@/components/traceability/lots-table";
import { classifyExpiration } from "@/lib/expiration/thresholds";
import type { ExpirationThresholds, Lot, Pallet } from "@/lib/types";
import { EmptyState, FilterPanel, SectionHeader } from "@/components/ui/design-system";

const DAY = 86_400_000;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}

function expirationGroup(expirationDate: string | null, thresholds: ExpirationThresholds) {
  if (!expirationDate) return "none";
  const days = Math.floor((Date.parse(`${expirationDate}T00:00:00Z`) - Date.now()) / DAY);
  return classifyExpiration(days, thresholds) ?? "later";
}

export function LotTrackingPanel({ lots, pallets, thresholds }: { lots: Lot[]; pallets: Pallet[]; thresholds: ExpirationThresholds }) {
  const [search, setSearch] = useState("");
  const [expiration, setExpiration] = useState("");
  const [status, setStatus] = useState("");
  const query = normalize(search.trim());
  const palletsByLot = useMemo(() => new Map(lots.map((lot) => [lot.id, pallets.filter((pallet) => pallet.batchNumber === lot.batchNumber && pallet.productSku === lot.productSku).length])), [lots, pallets]);
  const visibleLots = lots.filter((lot) =>
    (!query || [lot.batchNumber, lot.productName, lot.productSku].some((value) => normalize(value).includes(query))) &&
    (!expiration || expirationGroup(lot.expirationDate, thresholds) === expiration) &&
    (!status || (status === "with_pallets" ? (palletsByLot.get(lot.id) ?? 0) > 0 : (palletsByLot.get(lot.id) ?? 0) === 0)),
  );
  const hasFilters = Boolean(search || expiration || status);

  function clearFilters() {
    setSearch("");
    setExpiration("");
    setStatus("");
  }

  return (
    <section className="space-y-10" aria-label="Seguimiento de lotes">
      <FilterPanel label="Filtros de lotes" onClear={hasFilters ? clearFilters : undefined}>
        <label className="form-label">Buscar
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Número de lote, producto o SKU" className="form-control mt-2" />
        </label>
        <label className="form-label">Vencimiento
          <select value={expiration} onChange={(event) => setExpiration(event.target.value)} className="form-control mt-2"><option value="">Todos los vencimientos</option><option value="critical">Hasta {thresholds.criticalDays} días</option><option value="warning">{thresholds.criticalDays + 1} a {thresholds.cautionDays} días</option><option value="upcoming">{thresholds.cautionDays + 1} a {thresholds.upcomingDays} días</option><option value="later">Más de {thresholds.upcomingDays} días</option><option value="none">Sin fecha</option></select>
        </label>
        <label className="form-label">Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="form-control mt-2"><option value="">Todos los lotes</option><option value="with_pallets">Con pallets</option><option value="without_pallets">Sin pallets</option></select>
        </label>
      </FilterPanel>

      <div className="section-stack">
        <SectionHeader
          title="Lotes registrados"
          action={<p role="status" className="text-sm text-stone-500">Mostrando {visibleLots.length} de {lots.length}</p>}
        />
        {visibleLots.length === 0 ? <div className="surface"><EmptyState
          title={lots.length === 0 ? "Todavía no hay lotes" : "Sin resultados para estos filtros"}
          description={lots.length === 0 ? "Los lotes registrados para tu empresa aparecerán acá." : "Cambiá la búsqueda o los filtros para encontrar otros lotes."}
          action={lots.length > 0 && hasFilters ? <button type="button" onClick={clearFilters} className="button-secondary">Limpiar filtros</button> : undefined}
        /></div> : <LotsTable lots={visibleLots} pallets={pallets} />}
      </div>
    </section>
  );
}
