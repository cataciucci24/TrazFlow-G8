"use client";

import Link from "next/link";
import { PalletQrButton } from "@/components/pallets/pallet-qr-button";
import { useMemo, useState } from "react";

import { ErpOriginCell } from "@/components/erp/erp-origin";
import { PalletActions } from "@/components/pallets/pallet-actions";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { ExistingProduct, PalletWithHistory, ProductBatch } from "@/lib/types";
import { EmptyState, FilterPanel, CompactSummaryCard, PalletStatusBadge, SectionHeader, TableShell } from "@/components/ui/design-system";

// Las etiquetas salen de PALLET_STATUS_LABELS para que tarjetas, filtro y badges digan lo mismo.
const statusCards = [
  { value: "in_warehouse", tone: "sky" },
  { value: "assigned", tone: "violet" },
  { value: "in_transit", tone: "amber" },
  { value: "delivered", tone: "green" },
  { value: "delivery_discrepancy", tone: "red" },
] as const;


function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR");
}
export function PalletTrackingPanel({
  pallets,
  existingBatches,
  existingProducts,
  initialStatus = "",
  erpManaged = false,
}: {
  pallets: PalletWithHistory[];
  existingBatches: ProductBatch[];
  existingProducts: ExistingProduct[];
  initialStatus?: string;
  /**
   * Con ERP (TRZ-100): solo se edita la cantidad de los pallets armados en TrazFlow contra un lote del ERP. Los
   * heredados de saldos del ERP y los de lotes manuales no se editan.
   */
  erpManaged?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const locations = useMemo(() => Array.from(new Set(pallets.map((pallet) => pallet.currentLocation?.trim() || ""))).sort((a, b) => a.localeCompare(b, "es-AR")), [pallets]);
  const query = normalize(search.trim());
  const visiblePallets = pallets.filter((pallet) =>
    (!location || (pallet.currentLocation?.trim() || "") === location) &&
    (!status || pallet.status === status) &&
    (!query || [pallet.qrCode, pallet.productName, pallet.productSku, pallet.batchNumber, pallet.origin?.externalId ?? ""].some((value) => normalize(value).includes(query))),
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
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Código QR, producto, SKU, lote o id del ERP" className="form-control mt-2" />
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
          action={<div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-stone-500">Mostrando {visiblePallets.length} de {pallets.length}</p>{selectedIds.length > 0 && <Link href={`/dashboard/pallets/print?ids=${selectedIds.join(",")}`} className="button-primary button-sm">Imprimir selección ({selectedIds.length})</Link>}</div>}
        />
        {visiblePallets.length === 0 ? <div className="surface"><EmptyState
          title={pallets.length === 0 ? "Todavía no hay pallets" : "Sin resultados para estos filtros"}
          description={pallets.length === 0 ? "Los pallets registrados para tu empresa aparecerán acá." : "Cambiá la búsqueda o los filtros para encontrar otros pallets."}
          action={pallets.length > 0 && hasFilters ? <button type="button" onClick={clearFilters} className="button-secondary">Limpiar filtros</button> : undefined}
        /></div> : <TableShell label="Pallets registrados" mobileLayout="rows">
          <table role="table" aria-label="Pallets registrados" className="data-table min-w-[900px]">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col"><span className="sr-only">Seleccionar</span></th><th role="columnheader" scope="col">Código</th><th role="columnheader" scope="col">Producto</th><th role="columnheader" scope="col">Lote</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Ubicación</th><th role="columnheader" scope="col">Origen</th><th role="columnheader" scope="col" className="text-right">Acciones</th></tr></thead>
            <tbody role="rowgroup">
              {visiblePallets.map((pallet) => <tr role="row" key={pallet.id}><td role="cell" data-label="Seleccionar"><input type="checkbox" aria-label={`Seleccionar pallet ${pallet.qrCode}`} checked={selectedIds.includes(pallet.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, pallet.id] : current.filter((id) => id !== pallet.id))} /></td><td role="cell" data-label="Código" className="mobile-primary font-mono font-bold">{pallet.qrCode}</td><td role="cell" data-label="Producto" className="font-medium">{pallet.productName}</td><td role="cell" data-label="Lote" className="font-mono text-stone-600">{pallet.batchNumber}</td><td role="cell" data-label="Estado" className="mobile-priority"><PalletStatusBadge status={pallet.status} /></td><td role="cell" data-label="Ubicación" className="mobile-priority text-stone-500">{pallet.currentLocation ?? "—"}</td><td role="cell" data-label="Origen" className="mobile-wide"><ErpOriginCell origin={pallet.origin} /></td><td role="cell" data-label="Acciones" className="mobile-actions text-right"><div className="table-row-actions"><Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="button-secondary button-sm">Ver trazabilidad</Link><PalletQrButton pallet={pallet} variant="compact" /><Link href={`/dashboard/pallets/print?ids=${pallet.id}`} className="button-secondary button-sm">Imprimir</Link><PalletActions pallet={pallet} existingBatches={existingBatches} existingProducts={existingProducts} allowEdit={pallet.origin?.sourceSystem !== "erp" && (!erpManaged || pallet.lotSourceSystem === "erp")} quantityOnly={erpManaged} /></div></td></tr>)}
            </tbody>
          </table>
        </TableShell>}
      </div>
    </section>
  );
}
