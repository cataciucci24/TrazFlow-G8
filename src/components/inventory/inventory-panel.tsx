"use client";

import { useState } from "react";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { Pallet } from "@/lib/types";
import { FilterPanel, EmptyState, SectionHeader } from "@/components/ui/design-system";
import { groupByLocation, locationLabel, locationOf, LocationStockCard, LocationStockTable } from "@/components/inventory/location-stock";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}

export function InventoryPanel({ pallets, initialSearch = "" }: { pallets: Pallet[]; initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch);
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const locations = Array.from(new Set(pallets.map(locationOf)))
    .sort((a, b) => (a ?? "").localeCompare(b ?? "", "es-AR"));
  const query = normalize(search.trim());
  const visiblePallets = pallets.filter((pallet) =>
    (!location || JSON.stringify(locationOf(pallet)) === location) &&
    (!status || pallet.status === status) &&
    (!query || [pallet.productName, pallet.productSku, pallet.batchNumber, pallet.qrCode]
      .some((value) => normalize(value).includes(query))),
  );
  const hasFilters = Boolean(search || location || status);
  // Sin filtros: una tarjeta por ubicación con acceso a su página. Con filtros: tablas con lo que cumple.
  const groups = groupByLocation(visiblePallets);

  function clearFilters() {
    setSearch("");
    setLocation("");
    setStatus("");
  }

  return (
    <div className="space-y-10">
      <FilterPanel label="Filtros de stock" onClear={hasFilters ? clearFilters : undefined}>
        <label className="form-label">
          Buscar pallets
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Producto, SKU, lote o código QR" className="form-control mt-2" />
        </label>
        <label className="form-label">
          Ubicación
          <select value={location} onChange={(event) => setLocation(event.target.value)} className="form-control mt-2">
            <option value="">Todas las ubicaciones</option>
            {locations.map((value) => (
              <option key={JSON.stringify(value)} value={JSON.stringify(value)}>
                {value ?? "Sin ubicación registrada"}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="form-control mt-2">
            <option value="">Todos los estados</option>
            {Object.entries(PALLET_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </FilterPanel>

      <section className="section-stack" aria-labelledby="stock-list-title">
        <SectionHeader
          id="stock-list-title"
          title="Stock registrado"
          action={<p role="status" className="text-sm text-stone-500">Mostrando {visiblePallets.length} de {pallets.length}</p>}
        />
        {visiblePallets.length === 0 ? (
        <div className="surface">
          <EmptyState
            title={pallets.length === 0 ? "Todavía no hay pallets" : "Sin resultados para estos filtros"}
            description={pallets.length === 0
              ? "Los pallets registrados para tu empresa aparecerán acá."
              : "Probá con otra búsqueda o cambiá los filtros de ubicación y estado."}
            action={pallets.length > 0 && hasFilters ? <button type="button" onClick={clearFilters} className="button-secondary">Limpiar filtros</button> : undefined}
          />
        </div>
        ) : hasFilters ? groups.map(([value, group]) => (
          <section key={JSON.stringify(value)} aria-label={`Pallets: ${locationLabel(value)}`} className="section-stack [&_.section-title]:break-words">
            <SectionHeader title={locationLabel(value)} description={`${group.length} ${group.length === 1 ? "pallet" : "pallets"} en esta ubicación.`} />
            <LocationStockTable location={value} pallets={group} filtered />
          </section>
        )) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(([value, group]) => <LocationStockCard key={JSON.stringify(value)} location={value} pallets={group} />)}
          </div>
        )}
      </section>
    </div>
  );
}
