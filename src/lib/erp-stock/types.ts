/**
 * "Stock según ERP" (TRZ-100): saldo de cada lote del ERP en un depósito de TrazFlow y cuánto queda para armar
 * pallets. Sin entorno ni red: seguro para componentes cliente. Los números los calcula la base
 * (erp_stock_overview, 20261028100300_trz100_erp_stock_cap.sql) con la misma regla que el tope.
 */
import type { ProductUnit } from "../pallets/units.ts";

/**
 * Por qué hay despachados que todavía cuentan contra el saldo:
 *   - awaiting_document: el reporte no se envió o el remito está sin consultar o en borrador;
 *   - confirmed_unsynced: el remito se confirmó, pero el saldo es anterior a la confirmación;
 *   - document_problem: el remito está anulado o no se encontró en el ERP (hay que revisar).
 */
export type ErpStockDocumentLabel = "awaiting_document" | "confirmed_unsynced" | "document_problem";

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
  documentLabel: ErpStockDocumentLabel | null;
  /** Despachado con el remito todavía sin confirmar en el ERP. */
  awaitingQuantity: number;
  /** Remitos en borrador o sin consultar (p. ej. MAT-DN-2026-00001). */
  awaitingReferences: string[];
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

/** Texto de la etiqueta del remito, o null cuando todo está al día. */
export function documentLabelText(row: Pick<ErpStockRow, "documentLabel" | "awaitingReferences">): string | null {
  switch (row.documentLabel) {
    case "awaiting_document":
      return row.awaitingReferences.length
        ? `Esperando remito (${row.awaitingReferences.join(", ")})`
        : "Esperando remito";
    case "confirmed_unsynced":
      return "Remito confirmado, falta sincronizar";
    case "document_problem":
      return "Remito anulado / no encontrado en el ERP";
    case null:
      return null;
  }
}

/** Aviso (no bloquea) al elegir el lote en el alta. */
export function awaitingDocumentWarning(row: Pick<ErpStockRow, "awaitingQuantity" | "unitOfMeasure">): string | null {
  if (row.awaitingQuantity <= 0) return null;
  return `Hay ${formatStockQuantity(row.awaitingQuantity, row.unitOfMeasure)} despachadas con remito todavía sin confirmar en el ERP.`;
}

/** Se pueden armar pallets del lote: activo, de producto activo y con saldo disponible. */
export function canBuildFrom(row: Pick<ErpStockRow, "lotActive" | "productActive" | "available">): boolean {
  return row.lotActive && row.productActive && row.available > 0;
}

/** Fila cruda de erp_stock_overview → ErpStockRow. */
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
    documentLabel: (raw.document_label as ErpStockDocumentLabel | null) ?? null,
    awaitingQuantity: Number(raw.awaiting_quantity ?? 0),
    awaitingReferences: Array.isArray(raw.awaiting_references) ? raw.awaiting_references.map(String) : [],
  };
}
