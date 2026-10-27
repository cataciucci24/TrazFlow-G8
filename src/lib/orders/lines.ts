/**
 * Pedido vs. armado de una orden del ERP (TRZ-100). Sin entorno ni red: se puede probar y usar en la UI.
 *
 * Pedido = suma de las líneas de la orden (dispatch_order_lines) por producto. Armado = suma de los pallets
 * asociados con expected = true. La validación por QR sigue permitida, pero si hay diferencia el despacho no se
 * confirma: confirm_dispatch_order devuelve quantity_mismatch (20261028100400_trz100_dispatch_quantity_match.sql),
 * porque el ERP admite un solo reporte por orden. La comparación es exacta (dos decimales), también en kilogramos.
 */
import type { ProductUnit } from "../pallets/units.ts";

export type OrderLineInput = { productId: string; productName: string; productSku: string; unitOfMeasure: ProductUnit; quantity: number };
export type OrderPalletInput = { productId: string; productName: string; productSku: string; unitOfMeasure: ProductUnit; quantity: number | null };

export type OrderProductComparison = {
  productId: string;
  productName: string;
  productSku: string;
  unitOfMeasure: ProductUnit;
  requested: number;
  built: number;
  /** armado − pedido: positivo = sobra, negativo = falta. */
  difference: number;
};

/** Evita restos de coma flotante (40,1 − 40 = 0,0999…): las cantidades tienen a lo sumo dos decimales. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function compareOrderLines(lines: OrderLineInput[], pallets: OrderPalletInput[]): OrderProductComparison[] {
  const byProduct = new Map<string, OrderProductComparison>();
  const entry = (item: OrderLineInput | OrderPalletInput) => {
    let row = byProduct.get(item.productId);
    if (!row) {
      row = {
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        unitOfMeasure: item.unitOfMeasure,
        requested: 0,
        built: 0,
        difference: 0,
      };
      byProduct.set(item.productId, row);
    }
    return row;
  };
  for (const line of lines) entry(line).requested += line.quantity;
  for (const pallet of pallets) entry(pallet).built += pallet.quantity ?? 0;
  return [...byProduct.values()]
    .map((row) => ({ ...row, requested: round(row.requested), built: round(row.built), difference: round(row.built - row.requested) }))
    // Primero lo pedido (en el orden de las líneas), después lo armado que nadie pidió.
    .sort((a, b) => Number(b.requested > 0) - Number(a.requested > 0) || a.productName.localeCompare(b.productName, "es-AR"));
}

/** "sobran 5 cajas" / "faltan 40 cajas" / null si coincide. */
export function differenceWarning(row: Pick<OrderProductComparison, "difference" | "unitOfMeasure">): string | null {
  if (row.difference === 0) return null;
  const amount = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Math.abs(row.difference));
  return `${row.difference > 0 ? "sobran" : "faltan"} ${amount} ${row.unitOfMeasure}`;
}

/**
 * "No coincide con lo pedido: faltan 40 cajas de Arroz; sobran 5 cajas de Fideos." o null si todo coincide.
 * Es el motivo por el que no se puede confirmar el despacho.
 */
export function mismatchSummary(rows: OrderProductComparison[]): string | null {
  const parts = rows.flatMap((row) => {
    const warning = differenceWarning(row);
    return warning ? [`${warning} de ${row.productName}`] : [];
  });
  return parts.length ? `No coincide con lo pedido: ${parts.join("; ")}.` : null;
}
