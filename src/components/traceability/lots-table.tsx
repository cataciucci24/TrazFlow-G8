import Link from "next/link";

import type { Lot, Pallet } from "@/lib/types";
import { TableShell } from "@/components/ui/design-system";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });
const formatQuantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 20 });

function lotKey(productSku: string, batchNumber: string) {
  return JSON.stringify([productSku, batchNumber]);
}

type LotsTableProps = {
  lots: Lot[];
  pallets: Pallet[];
};

/** Lista todos los lotes de la empresa, agregando la cantidad de sus pallets ya cargados. */
export function LotsTable({ lots, pallets }: LotsTableProps) {
  const palletsByLot = new Map<string, Pallet[]>();
  for (const pallet of pallets) {
    const key = lotKey(pallet.productSku, pallet.batchNumber);
    const group = palletsByLot.get(key);
    if (group) group.push(pallet);
    else palletsByLot.set(key, [pallet]);
  }

  return (
    <TableShell label="Lotes registrados">
      <table className="data-table min-w-[640px]">
        <thead>
          <tr>
            {["Lote", "Producto", "SKU", "Vencimiento", "Pallets", "Cantidad total", "Acciones"].map((heading) => (
              <th key={heading} scope="col" className={heading === "SKU" ? "table-secondary-column" : ["Pallets", "Cantidad total"].includes(heading) ? "text-right" : undefined}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {lots.map((lot) => {
            const lotPallets = palletsByLot.get(lotKey(lot.productSku, lot.batchNumber)) ?? [];
            const total = lotPallets.reduce((sum, pallet) => sum + (pallet.quantity ?? 0), 0);

            return (
              <tr key={lot.id}>
                <td className="max-w-48 break-words font-mono font-bold">{lot.batchNumber}</td>
                <td className="max-w-64 break-words font-medium">{lot.productName}<span className="table-secondary block font-mono md:hidden">SKU {lot.productSku}</span></td>
                <td className="table-secondary-column max-w-48 break-words font-mono text-slate-600">{lot.productSku}</td>
                <td className="text-slate-500">{lot.expirationDate ? DATE_FORMATTER.format(new Date(`${lot.expirationDate}T00:00:00`)) : "—"}</td>
                <td className="text-right tabular-nums">{lotPallets.length}</td>
                <td className="text-right tabular-nums">
                  {total > 0 ? `${formatQuantity.format(total)} ${lot.unitOfMeasure}` : "Sin definir"}
                </td>
                <td className="text-right">
                  <Link
                    href={`/dashboard/traceability?view=lotes&lote=${encodeURIComponent(lot.batchNumber)}`}
                    className="button-secondary button-sm"
                  >
                    Ver trazabilidad
                  </Link>
                </td>
              </tr>
            );
          })}
          {lots.length === 0 && (
            <tr><td colSpan={7} className="table-empty">Todavía no hay lotes registrados.</td></tr>
          )}
        </tbody>
      </table>
    </TableShell>
  );
}
