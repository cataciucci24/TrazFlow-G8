/**
 * Redistribución entre depósitos con los saldos del ERP (TRZ-72). Sin entorno ni red.
 *
 * Regla simple, por producto: se suman los saldos del ERP de cada depósito. Si el que menos tiene no llega a la
 * mitad del que más tiene, se sugiere mover del que más tiene al que menos la mitad de la diferencia (así quedan
 * parejos). Es solo una sugerencia: TrazFlow no mueve stock.
 */
import type { ErpStockRow } from "../erp-stock/types.ts";
import type { ProductUnit } from "../pallets/units.ts";

export type WarehouseRedistribution = {
  productName: string;
  productSku: string;
  unitOfMeasure: ProductUnit;
  fromWarehouse: string;
  fromQuantity: number;
  toWarehouse: string;
  toQuantity: number;
  /** Cantidad a mover para emparejar los dos depósitos. */
  suggestedQuantity: number;
};

export function suggestWarehouseRedistributions(rows: ErpStockRow[]): WarehouseRedistribution[] {
  // Depósitos que el ERP usa (tienen saldo de algún producto). Los vacíos, como "en tránsito", no se sugieren.
  const warehouseCodes = [...new Set(rows.map((row) => row.warehouseCode))];
  const byProduct = new Map<string, { row: ErpStockRow; totals: Map<string, number> }>();
  for (const row of rows) {
    if (!row.productActive) continue;
    const entry = byProduct.get(row.productSku) ?? { row, totals: new Map<string, number>() };
    entry.totals.set(row.warehouseCode, (entry.totals.get(row.warehouseCode) ?? 0) + row.erpQuantity);
    byProduct.set(row.productSku, entry);
  }

  const suggestions: WarehouseRedistribution[] = [];
  for (const { row, totals } of byProduct.values()) {
    // Un depósito que el ERP usa pero sin saldo de este producto cuenta con 0.
    for (const code of warehouseCodes) if (!totals.has(code)) totals.set(code, 0);
    if (totals.size < 2) continue;

    const sorted = [...totals].sort((a, b) => b[1] - a[1]);
    const [fromWarehouse, fromQuantity] = sorted[0];
    const [toWarehouse, toQuantity] = sorted[sorted.length - 1];
    if (fromQuantity <= 0 || toQuantity >= fromQuantity / 2) continue;

    const half = (fromQuantity - toQuantity) / 2;
    const suggestedQuantity = row.unitOfMeasure === "kilogramos" ? Math.round(half * 100) / 100 : Math.floor(half);
    if (suggestedQuantity <= 0) continue;

    suggestions.push({
      productName: row.productName,
      productSku: row.productSku,
      unitOfMeasure: row.unitOfMeasure,
      fromWarehouse,
      fromQuantity,
      toWarehouse,
      toQuantity,
      suggestedQuantity,
    });
  }
  return suggestions.sort((a, b) => a.productName.localeCompare(b.productName));
}
