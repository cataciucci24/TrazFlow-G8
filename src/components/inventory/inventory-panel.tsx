"use client";

import { useState } from "react";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { Pallet } from "@/lib/types";
import { PALLET_UNITS } from "@/lib/pallets/units";
import { CompactSummaryCard, EmptyState, PalletStatusBadge, SectionHeader } from "@/components/ui/design-system";

const formatQuantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 20 });

const fieldClass = "form-control mt-2";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}

function locationOf(pallet: Pallet) {
  return pallet.currentLocation?.trim() || null;
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
  const groups = new Map<string | null, Pallet[]>();
  for (const pallet of visiblePallets) {
    const key = locationOf(pallet);
    const group = groups.get(key);
    if (group) group.push(pallet);
    else groups.set(key, [pallet]);
  }
  const hasFilters = Boolean(search || location || status);

  function clearFilters() {
    setSearch("");
    setLocation("");
    setStatus("");
  }

  return (
    <div className="space-y-10">
      <section aria-label="Filtros de stock" className="surface p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
          <label className="text-sm font-semibold md:col-span-2 xl:col-span-1">
            Buscar pallets
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Producto, SKU, lote o código QR" className={fieldClass} />
          </label>
          <label className="min-w-0 text-sm font-semibold">
            Ubicación
            <select value={location} onChange={(event) => setLocation(event.target.value)} className={fieldClass}>
              <option value="">Todas las ubicaciones</option>
              {locations.map((value) => (
                <option key={JSON.stringify(value)} value={JSON.stringify(value)}>
                  {value ?? "Sin ubicación registrada"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Estado
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
              <option value="">Todos los estados</option>
              {Object.entries(PALLET_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        {hasFilters && (
          <button type="button" onClick={clearFilters}
            className="button-secondary mt-4">
            Limpiar filtros
          </button>
        )}
      </section>

      <section aria-label="Resumen de stock" className="grid gap-4 sm:grid-cols-2">
        <CompactSummaryCard label="Total de pallets" value={pallets.length} tone="brand" />
        <CompactSummaryCard label="Ubicaciones registradas" value={locations.filter((value) => value !== null).length} tone="sky" />
      </section>

      <section className="section-stack" aria-labelledby="stock-list-title">
        <SectionHeader
          id="stock-list-title"
          title="Stock registrado"
          action={<p role="status" className="text-sm text-stone-500">Mostrando {visiblePallets.length} de {pallets.length}</p>}
        />
        {visiblePallets.length === 0 ? (
        <div className="surface">
          <EmptyState
            title={pallets.length === 0 ? "Todavía no hay pallets" : "No hay resultados"}
            description={pallets.length === 0
              ? "Los pallets registrados para tu empresa aparecerán acá."
              : "Probá con otra búsqueda o cambiá los filtros de ubicación y estado."}
          />
        </div>
        ) : locations.filter((value) => groups.has(value)).map((value) => {
        const group = groups.get(value)!;
        const defined = group.filter((pallet) => pallet.quantity !== null && pallet.unitOfMeasure !== null);
        const undefinedCount = group.length - defined.length;
        const positiveTotals = PALLET_UNITS.map((unit) => {
          const matching = defined.filter((pallet) => pallet.unitOfMeasure === unit);
          const total = matching.reduce((sum, pallet) => sum + pallet.quantity!, 0);
          return { unit, total };
        }).filter(({ total }) => total > 0);
        const label = value ?? "Sin ubicación registrada";
        return (
          <section key={JSON.stringify(value)} aria-label={`Pallets: ${label}`} className="section-stack">
            <SectionHeader title={label} description={`${group.length} ${group.length === 1 ? "pallet" : "pallets"} en esta ubicación.`} />
            <div className="surface overflow-hidden">
            <div className="space-y-2 border-b border-stone-200 px-5 py-4 text-sm">
              <p className="font-semibold">Total de mercadería{hasFilters ? " (según filtros)" : ""}</p>
              {positiveTotals.length > 0 ? (
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {positiveTotals.map(({ unit, total }) => (
                    <li key={unit}>{formatQuantity.format(total)} {unit}</li>
                  ))}
                </ul>
              ) : <p className="text-stone-500">Stock aún no cuantificado</p>}
              {undefinedCount > 0 && <p className="text-amber-800">{undefinedCount} {undefinedCount === 1 ? "pallet" : "pallets"} sin cantidad</p>}
            </div>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Detalle de stock: ${label}`}>
              <table className="data-table min-w-[900px]">
                <caption className="sr-only">Pallets en {label}</caption>
                <thead>
                  <tr>
                    {["Código QR", "Producto", "SKU", "Lote", "Cantidad", "Estado", "Ubicación"].map((heading) => (
                      <th key={heading} scope="col">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {group.map((pallet) => (
                    <tr key={pallet.id}>
                      <td className="max-w-64 break-words font-mono font-bold">{pallet.qrCode}</td>
                      <td className="max-w-64 break-words font-medium">{pallet.productName}</td>
                      <td className="max-w-48 break-words font-mono text-slate-600">{pallet.productSku}</td>
                      <td className="max-w-48 break-words font-mono text-slate-600">{pallet.batchNumber}</td>
                      <td className="tabular-nums">{pallet.quantity === null || pallet.unitOfMeasure === null ? "Sin definir" : `${formatQuantity.format(pallet.quantity)} ${pallet.unitOfMeasure}`}</td>
                      <td>
                        <PalletStatusBadge status={pallet.status} />
                      </td>
                      <td className="max-w-64 break-words text-slate-500">{locationOf(pallet) ?? "Sin ubicación registrada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </section>
        );
        })}
      </section>
    </div>
  );
}
