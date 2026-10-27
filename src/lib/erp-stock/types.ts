/**
 * "Stock según ERP" (TRZ-100): saldo de cada lote del ERP en un depósito de TrazFlow y cuánto queda para armar
 * pallets. Sin entorno ni red: seguro para componentes cliente. Los números los calcula la base
 * (erp_stock_overview, 20261028100300_trz100_erp_stock_cap.sql) con la misma regla que el tope.
 */
import type { ProductUnit } from "../pallets/units.ts";

export type ErpStockRow = {
  batchId: string;
  batchNumber: string;
  expirationDate: string | null;
  lotActive: boolean;
  productId: string;
  productName: string;
  productSku: string;
  unitOfMeasure: ProductUnit;
  productActive: boolean;
  warehouseCode: string;
  /** Saldo del ERP (suma de los depósitos del ERP vinculados a warehouseCode). */
  erpQuantity: number;
  /** Pallets que todavía no salieron (en depósito o asignados a una orden sin confirmar). */
  built: number;
  /** Despachados que el ERP todavía no descontó. */
  dispatchedPending: number;
  /** Lo que queda para armar. Puede ser negativo si el saldo bajó o un remito se anuló. */
  available: number;
  /** La sincronización más vieja entre los saldos sumados. */
  oldestSyncedAt: string;
};

const QUANTITY_FORMAT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** "356,5 kilogramos", "1 caja", "40 cajas". */
export function formatStockQuantity(quantity: number, unit: ProductUnit): string {
  const singular = Math.abs(quantity) === 1;
  const label = unit === "cajas" ? (singular ? "caja" : "cajas")
    : unit === "unidades" ? (singular ? "unidad" : "unidades")
    : (singular ? "kilogramo" : "kilogramos");
  return `${QUANTITY_FORMAT.format(quantity)} ${label}`;
}

/** Se pueden armar pallets del lote: activo, de producto activo y con saldo disponible. */
export function canBuildFrom(row: Pick<ErpStockRow, "lotActive" | "productActive" | "available">): boolean {
  return row.lotActive && row.productActive && row.available > 0;
}

/**
 * Fila cruda de erp_stock_overview → ErpStockRow. La función también devuelve el estado del remito
 * (document_label, awaiting_*), pero la app no lo usa: el disponible ya descuenta lo despachado sin remito
 * confirmado, y el estado del remito se ve en Integración ERP.
 */
export function toErpStockRow(raw: Record<string, unknown>): ErpStockRow {
  return {
    batchId: String(raw.batch_id),
    batchNumber: String(raw.batch_number),
    expirationDate: (raw.expiration_date as string | null) ?? null,
    lotActive: raw.lot_active !== false,
    productId: String(raw.product_id),
    productName: String(raw.product_name),
    productSku: String(raw.product_sku),
    unitOfMeasure: raw.unit_of_measure as ProductUnit,
    productActive: raw.product_active !== false,
    warehouseCode: String(raw.warehouse_code),
    erpQuantity: Number(raw.erp_quantity),
    built: Number(raw.built),
    dispatchedPending: Number(raw.dispatched_pending),
    available: Number(raw.available),
    oldestSyncedAt: String(raw.oldest_synced_at),
  };
}
