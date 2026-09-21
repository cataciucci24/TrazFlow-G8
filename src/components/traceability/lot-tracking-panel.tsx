"use client";

import { useMemo, useState } from "react";

import { LotsTable } from "@/components/traceability/lots-table";
import type { Lot, Pallet } from "@/lib/types";
import { CompactSummaryCard, SectionHeader } from "@/components/ui/design-system";

const fieldClass = "form-control mt-2";
const DAY = 86_400_000;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}

function expirationGroup(expirationDate: string | null) {
  if (!expirationDate) return "none";
  const days = Math.floor((Date.parse(`${expirationDate}T00:00:00Z`) - Date.now()) / DAY);
  if (days <= 30) return "critical";
  if (days <= 60) return "warning";
  if (days <= 90) return "upcoming";
  return "later";
}

export function LotTrackingPanel({ lots, pallets }: { lots: Lot[]; pallets: Pallet[] }) {
  const [search, setSearch] = useState("");
  const [expiration, setExpiration] = useState("");
  const [status, setStatus] = useState("");
  const query = normalize(search.trim());
  const palletsByLot = useMemo(() => new Map(lots.map((lot) => [lot.id, pallets.filter((pallet) => pallet.batchNumber === lot.batchNumber && pallet.productSku === lot.productSku).length])), [lots, pallets]);
  const visibleLots = lots.filter((lot) =>
    (!query || [lot.batchNumber, lot.productName, lot.productSku].some((value) => normalize(value).includes(query))) &&
    (!expiration || expirationGroup(lot.expirationDate) === expiration) &&
    (!status || (status === "with_pallets" ? (palletsByLot.get(lot.id) ?? 0) > 0 : (palletsByLot.get(lot.id) ?? 0) === 0)),
  );
  const hasFilters = Boolean(search || expiration || status);
  const lotsWithPallets = lots.filter((lot) => (palletsByLot.get(lot.id) ?? 0) > 0).length;
  const lotsWithoutPallets = lots.length - lotsWithPallets;
  const expiringLots = lots.filter((lot) => ["critical", "warning", "upcoming"].includes(expirationGroup(lot.expirationDate))).length;

  function clearFilters() {
    setSearch("");
    setExpiration("");
    setStatus("");
  }

  return (
    <section className="space-y-10" aria-label="Seguimiento de lotes">
      <section aria-label="Filtros de lotes" className="surface p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
            <label className="text-sm font-semibold md:col-span-2 xl:col-span-1">Buscar
              <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Número de lote, producto o SKU" className={fieldClass} />
            </label>
            <label className="text-sm font-semibold">Vencimiento
              <select value={expiration} onChange={(event) => setExpiration(event.target.value)} className={fieldClass}><option value="">Todos los vencimientos</option><option value="critical">Hasta 30 días</option><option value="warning">31 a 60 días</option><option value="upcoming">61 a 90 días</option><option value="later">Más de 90 días</option><option value="none">Sin fecha</option></select>
            </label>
            <label className="text-sm font-semibold">Estado
              <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}><option value="">Todos los lotes</option><option value="with_pallets">Con pallets</option><option value="without_pallets">Sin pallets</option></select>
            </label>
        </div>
        {hasFilters && <button type="button" onClick={clearFilters} className="button-secondary mt-4">Limpiar filtros</button>}
      </section>

      <section aria-label="Resumen de lotes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CompactSummaryCard label="Total de lotes" value={lots.length} tone="brand" />
        <CompactSummaryCard label="Con pallets" value={lotsWithPallets} tone="green" />
        <CompactSummaryCard label="Sin pallets" value={lotsWithoutPallets} tone="neutral" />
        <CompactSummaryCard label="Vencen en 90 días" value={expiringLots} tone="amber" />
      </section>

      <div className="section-stack">
        <SectionHeader
          title="Lotes registrados"
          action={<p role="status" className="text-sm text-stone-500">Mostrando {visibleLots.length} de {lots.length}</p>}
        />
        <LotsTable lots={visibleLots} pallets={pallets} />
      </div>
    </section>
  );
}
