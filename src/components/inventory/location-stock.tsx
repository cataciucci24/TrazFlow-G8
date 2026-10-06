import Link from "next/link";

import { PalletStatusBadge, TableShell } from "@/components/ui/design-system";
import { PRODUCT_UNITS } from "@/lib/pallets/units";
import type { Pallet } from "@/lib/types";

const formatQuantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 20 });

export const NO_LOCATION_LABEL = "Sin ubicación registrada";

export function locationOf(pallet: Pallet) {
  return pallet.currentLocation?.trim() || null;
}

export function locationLabel(location: string | null) {
  return location ?? NO_LOCATION_LABEL;
}

/** Página de detalle de una ubicación; sin `nombre` corresponde a los pallets sin ubicación. */
export function locationHref(location: string | null) {
  return location === null ? "/dashboard/inventory/ubicacion" : `/dashboard/inventory/ubicacion?nombre=${encodeURIComponent(location)}`;
}

/** Agrupa pallets por ubicación, ordenadas alfabéticamente ("sin ubicación" primero). */
export function groupByLocation(pallets: Pallet[]) {
  const groups = new Map<string | null, Pallet[]>();
  for (const pallet of pallets) {
    const key = locationOf(pallet);
    const group = groups.get(key);
    if (group) group.push(pallet);
    else groups.set(key, [pallet]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => (a ?? "").localeCompare(b ?? "", "es-AR"));
}

/** Totales por unidad: cada pallet suma en la unidad de su producto. */
function summarizeStock(pallets: Pallet[]) {
  const defined = pallets.filter((pallet) => pallet.quantity !== null);
  const totals = PRODUCT_UNITS.map((unit) => ({
    unit,
    total: defined.filter((pallet) => pallet.unitOfMeasure === unit).reduce((sum, pallet) => sum + pallet.quantity!, 0),
  })).filter(({ total }) => total > 0);
  return { totals, undefinedCount: pallets.length - defined.length };
}

function palletCount(count: number) {
  return `${count} ${count === 1 ? "pallet" : "pallets"}`;
}

/** Tarjeta de una ubicación en la vista general de Stock (sin filtros). */
export function LocationStockCard({ location, pallets }: { location: string | null; pallets: Pallet[] }) {
  const label = locationLabel(location);
  const { totals, undefinedCount } = summarizeStock(pallets);
  return (
    <article className="surface flex flex-col gap-4 p-5" aria-label={`Ubicación: ${label}`}>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="break-words text-base font-bold text-stone-900">{label}</h3>
        <p className="text-sm text-stone-600">
          {[palletCount(pallets.length), ...totals.map(({ unit, total }) => `${formatQuantity.format(total)} ${unit}`)].join(" · ")}
        </p>
        {undefinedCount > 0 && <p className="text-sm text-amber-800">{palletCount(undefinedCount)} sin cantidad</p>}
      </div>
      <Link href={locationHref(location)} className="button-secondary button-sm self-start">Ver stock</Link>
    </article>
  );
}

/** Totales y tabla de pallets de una ubicación. */
export function LocationStockTable({ location, pallets, filtered = false }: { location: string | null; pallets: Pallet[]; filtered?: boolean }) {
  const label = locationLabel(location);
  const { totals, undefinedCount } = summarizeStock(pallets);
  return (
    <div className="surface overflow-hidden">
      <div className="space-y-2 border-b border-stone-200 px-5 py-4 text-sm">
        <p className="font-semibold">Total de mercadería{filtered ? " (según filtros)" : ""}</p>
        {totals.length > 0 ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {totals.map(({ unit, total }) => (
              <li key={unit}>{formatQuantity.format(total)} {unit}</li>
            ))}
          </ul>
        ) : <p className="text-stone-500">Stock aún no cuantificado</p>}
        {undefinedCount > 0 && <p className="text-amber-800">{palletCount(undefinedCount)} sin cantidad</p>}
      </div>
      <TableShell label={`Detalle de stock: ${label}`} className="table-embedded">
        <table className="data-table min-w-[640px]">
          <caption className="sr-only">Pallets en {label}</caption>
          <thead>
            <tr>
              {["Código QR", "Producto", "SKU", "Lote", "Cantidad", "Estado", "Ubicación"].map((heading) => (
                <th key={heading} scope="col" className={["SKU", "Lote"].includes(heading) ? "table-secondary-column" : heading === "Cantidad" ? "text-right" : undefined}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {pallets.map((pallet) => (
              <tr key={pallet.id}>
                <td className="max-w-64 break-words font-mono font-bold">{pallet.qrCode}</td>
                <td className="max-w-64 break-words font-medium">{pallet.productName}<span className="table-secondary block md:hidden">SKU {pallet.productSku} · Lote {pallet.batchNumber}</span></td>
                <td className="table-secondary-column max-w-48 break-words font-mono text-slate-600">{pallet.productSku}</td>
                <td className="table-secondary-column max-w-48 break-words font-mono text-slate-600">{pallet.batchNumber}</td>
                <td className="text-right tabular-nums">{pallet.quantity === null ? "Sin definir" : `${formatQuantity.format(pallet.quantity)} ${pallet.unitOfMeasure}`}</td>
                <td>
                  <PalletStatusBadge status={pallet.status} />
                </td>
                <td className="max-w-64 break-words text-slate-500">{locationLabel(locationOf(pallet))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}
