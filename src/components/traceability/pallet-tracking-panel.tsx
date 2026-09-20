"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PalletActions } from "@/components/pallets/pallet-actions";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { ExistingProduct, Pallet, ProductBatch } from "@/lib/types";

const statusDetails = [
  { value: "in_warehouse", label: "En depósito", className: "bg-sky-50 text-sky-700" },
  { value: "assigned", label: "Asignado", className: "bg-violet-50 text-violet-700" },
  { value: "in_transit", label: "Despachado", className: "bg-amber-50 text-amber-700" },
  { value: "received", label: "Entregado", className: "bg-emerald-50 text-emerald-700" },
] as const;

const fieldClass = "mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-100";

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
    <section className="space-y-5" aria-label="Seguimiento de pallets">
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
          <label className="text-sm font-semibold md:col-span-2 xl:col-span-1">Buscar
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Código QR, producto, SKU o lote" className={fieldClass} />
          </label>
          <label className="text-sm font-semibold">Ubicación
            <select value={location} onChange={(event) => setLocation(event.target.value)} className={fieldClass}>
              <option value="">Todas las ubicaciones</option>
              {locations.map((value) => <option key={value || "none"} value={value}>{value || "Sin ubicación registrada"}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Estado
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
              <option value="">Todos los estados</option>
              {Object.entries(PALLET_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {hasFilters && <button type="button" onClick={clearFilters} className="mt-4 rounded-xl border border-stone-200 px-4 py-2 text-sm font-bold text-stone-600 transition-colors hover:bg-stone-50">Limpiar filtros</button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusDetails.map((detail) => {
          const count = pallets.filter((pallet) => pallet.status === detail.value).length;
          return <div key={detail.value} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3"><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${detail.className}`}>{detail.label}</span><span className="text-xl font-bold tabular-nums">{count}</span></div>;
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Pallets registrados</h2>
        <p className="text-sm text-stone-500">Mostrando {visiblePallets.length} de {pallets.length}</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead><tr className="bg-stone-100/80 text-stone-500"><th className="px-5 py-4 font-semibold">Código</th><th className="px-5 py-4 font-semibold">Producto</th><th className="px-5 py-4 font-semibold">Lote</th><th className="px-5 py-4 font-semibold">Estado</th><th className="px-5 py-4 font-semibold">Ubicación</th><th className="px-5 py-4 text-right font-semibold">Acciones</th></tr></thead>
          <tbody className="divide-y divide-stone-200">
            {visiblePallets.map((pallet) => <tr key={pallet.id} className="hover:bg-amber-50/40"><td className="px-5 py-4 font-mono font-bold">{pallet.qrCode}</td><td className="px-5 py-4 font-medium">{pallet.productName}</td><td className="px-5 py-4 font-mono text-stone-600">{pallet.batchNumber}</td><td className="px-5 py-4"><PalletStatus status={pallet.status} /></td><td className="px-5 py-4 text-stone-500">{pallet.currentLocation ?? "—"}</td><td className="px-5 py-4 text-right"><div className="flex items-center justify-end gap-4"><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="text-xs font-bold text-amber-600 hover:text-amber-700">Ver trazabilidad</Link><PalletActions pallet={pallet} existingBatches={existingBatches} existingProducts={existingProducts} /></div></td></tr>)}
            {visiblePallets.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-500">No hay pallets para estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PalletStatus({ status }: { status: Pallet["status"] }) {
  const classes = status === "received" ? "bg-emerald-50 text-emerald-700" : status === "in_transit" ? "bg-amber-50 text-amber-700" : status === "assigned" ? "bg-violet-50 text-violet-700" : status === "in_warehouse" ? "bg-sky-50 text-sky-700" : "bg-red-50 text-red-700";
  return <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}>{PALLET_STATUS_LABELS[status]}</span>;
}
