"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PalletActions } from "@/components/pallets/pallet-actions";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { ExistingProduct, Pallet, ProductBatch } from "@/lib/types";
import { CompactSummaryCard, PalletStatusBadge, SectionHeader, TableShell } from "@/components/ui/design-system";

const statusDetails = [
  { value: "in_warehouse", label: "En depósito", tone: "sky" },
  { value: "assigned", label: "Asignados", tone: "violet" },
  { value: "in_transit", label: "Despachados", tone: "amber" },
  { value: "received", label: "Entregados", tone: "green" },
] as const;

const fieldClass = "form-control mt-2";

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
      <section aria-label="Filtros de pallets" className="surface p-5">
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
        {hasFilters && <button type="button" onClick={clearFilters} className="button-secondary mt-4">Limpiar filtros</button>}
      </section>

      <section aria-label="Resumen de pallets" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statusDetails.map((detail) => {
          const count = pallets.filter((pallet) => pallet.status === detail.value).length;
          return <CompactSummaryCard key={detail.value} label={detail.label} value={count} tone={detail.tone} />;
        })}
      </section>

      <div className="section-stack">
        <SectionHeader
          title="Pallets registrados"
          action={<p role="status" className="text-sm text-stone-500">Mostrando {visiblePallets.length} de {pallets.length}</p>}
        />
        <TableShell label="Pallets registrados">
          <table className="data-table min-w-[780px]">
            <thead><tr><th>Código</th><th>Producto</th><th>Lote</th><th>Estado</th><th>Ubicación</th><th className="text-right">Acciones</th></tr></thead>
            <tbody>
              {visiblePallets.map((pallet) => <tr key={pallet.id}><td className="font-mono font-bold">{pallet.qrCode}</td><td className="font-medium">{pallet.productName}</td><td className="font-mono text-stone-600">{pallet.batchNumber}</td><td><PalletStatusBadge status={pallet.status} /></td><td className="text-stone-500">{pallet.currentLocation ?? "—"}</td><td className="text-right"><div className="flex items-center justify-end gap-4"><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="table-action">Ver trazabilidad</Link><PalletActions pallet={pallet} existingBatches={existingBatches} existingProducts={existingProducts} /></div></td></tr>)}
              {visiblePallets.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-500">No hay pallets para estos filtros.</td></tr>}
            </tbody>
          </table>
        </TableShell>
      </div>
    </section>
  );
}
