"use client";

import { useState } from "react";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { Pallet } from "@/lib/types";

const STATUS_CLASSES: Record<Pallet["status"], string> = {
  in_warehouse: "bg-sky-50 text-sky-700",
  assigned: "bg-violet-50 text-violet-700",
  in_transit: "bg-amber-50 text-amber-700",
  received: "bg-emerald-50 text-emerald-700",
  discrepancy: "bg-red-50 text-red-700",
};

const fieldClass = "mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}

function locationOf(pallet: Pallet) {
  return pallet.currentLocation?.trim() || null;
}

export function InventoryPanel({ pallets }: { pallets: Pallet[] }) {
  const [search, setSearch] = useState("");
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
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <dt className="text-sm text-stone-500">Total de pallets</dt>
          <dd className="mt-1 text-2xl font-bold">{pallets.length}</dd>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <dt className="text-sm text-stone-500">Ubicaciones registradas</dt>
          <dd className="mt-1 text-2xl font-bold">{locations.filter((value) => value !== null).length}</dd>
        </div>
      </dl>

      <section aria-label="Filtros de stock" className="rounded-2xl border border-stone-200 bg-white p-5">
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
            className="mt-4 rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50">
            Limpiar filtros
          </button>
        )}
      </section>

      <p role="status" className="text-sm text-stone-500">
        Mostrando {visiblePallets.length} de {pallets.length} pallets
      </p>

      {visiblePallets.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <h2 className="text-xl font-bold">{pallets.length === 0 ? "Todavía no hay pallets" : "No hay resultados"}</h2>
          <p className="mt-2 text-sm text-stone-500">
            {pallets.length === 0
              ? "Los pallets registrados para tu empresa aparecerán acá."
              : "Probá con otra búsqueda o cambiá los filtros de ubicación y estado."}
          </p>
        </div>
      ) : locations.filter((value) => groups.has(value)).map((value) => {
        const group = groups.get(value)!;
        const label = value ?? "Sin ubicación registrada";
        return (
          <section key={JSON.stringify(value)} aria-label={`Pallets: ${label}`}
            className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-5 py-4">
              <h2 className="min-w-0 break-words text-lg font-bold">{label}</h2>
              <span className="text-sm text-stone-500">{group.length} pallets</span>
            </div>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Detalle de stock: ${label}`}>
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">Pallets en {label}</caption>
                <thead className="bg-stone-100/80 text-stone-500">
                  <tr>
                    {["Código QR", "Producto", "SKU", "Lote", "Cantidad del lote", "Estado", "Ubicación"].map((heading) => (
                      <th key={heading} scope="col" className="px-5 py-4 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {group.map((pallet) => (
                    <tr key={pallet.id} className="transition-colors hover:bg-amber-50/40">
                      <td className="max-w-64 break-words px-5 py-4 font-mono font-bold">{pallet.qrCode}</td>
                      <td className="max-w-64 break-words px-5 py-4 font-medium">{pallet.productName}</td>
                      <td className="max-w-48 break-words px-5 py-4 font-mono text-stone-600">{pallet.productSku}</td>
                      <td className="max-w-48 break-words px-5 py-4 font-mono text-stone-600">{pallet.batchNumber}</td>
                      <td className="px-5 py-4 tabular-nums">{pallet.quantity}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${STATUS_CLASSES[pallet.status]}`}>
                          {PALLET_STATUS_LABELS[pallet.status]}
                        </span>
                      </td>
                      <td className="max-w-64 break-words px-5 py-4 text-stone-500">{locationOf(pallet) ?? "Sin ubicación registrada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
