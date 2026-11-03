import { argentinaToday } from "../plans/payments.ts";
import { isProductUnit, isValidQuantity, type ProductUnit } from "../pallets/units.ts";

export const MAX_IMPORT_ROWS = 5000;
/** Por debajo del límite de 4,5 MB de las funciones de Vercel. 5.000 filas ocupan bastante menos. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export const IMPORT_COLUMNS = [
  { key: "product", header: "Producto" },
  { key: "sku", header: "SKU" },
  { key: "unit", header: "Unidad" },
  { key: "lot", header: "Lote" },
  { key: "expiration", header: "Vencimiento" },
  { key: "warehouse", header: "Depósito" },
  { key: "quantity", header: "Cantidad" },
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number]["key"];
export type RawImportRow = { rowNumber: number; values: Record<ImportColumn, string> };
export type ImportRow = {
  row: number; product: string; sku: string; unit: ProductUnit; lot: string;
  expiration: string; warehouse: string; quantity: number;
};
export type ImportRowError = { row: number; messages: string[] };

const normalizeHeader = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** A partir de la primera fila no vacía: los encabezados pueden venir en cualquier orden. */
export function toRawRows(table: { rowNumber: number; cells: string[] }[]): { rows: RawImportRow[] } | { error: string } {
  const filled = table.filter(row => row.cells.some(cell => cell.trim()));
  if (!filled.length) return { error: "El archivo está vacío." };
  const headers = filled[0].cells.map(normalizeHeader);
  const positions = IMPORT_COLUMNS.map(column => headers.indexOf(normalizeHeader(column.header)));
  const missing = IMPORT_COLUMNS.filter((_, index) => positions[index] < 0).map(column => column.header);
  if (missing.length) return { error: `Faltan columnas: ${missing.join(", ")}. Usá la plantilla.` };
  const rows = filled.slice(1).map(({ rowNumber, cells }) => ({
    rowNumber,
    values: Object.fromEntries(IMPORT_COLUMNS.map((column, index) => [column.key, (cells[positions[index]] ?? "").trim()])) as Record<ImportColumn, string>,
  }));
  if (!rows.length) return { error: "El archivo no tiene filas para importar." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `El archivo tiene ${rows.length} filas y el máximo es ${MAX_IMPORT_ROWS}.` };
  return { rows };
}

const UNIT_ALIASES: Record<string, ProductUnit> = {
  unidad: "unidades", un: "unidades", caja: "cajas", kilogramo: "kilogramos", kilo: "kilogramos", kilos: "kilogramos", kg: "kilogramos", kgs: "kilogramos",
};

function parseUnit(text: string): ProductUnit | null {
  const unit = text.toLowerCase();
  return isProductUnit(unit) ? unit : UNIT_ALIASES[unit] ?? null;
}

/** Acepta YYYY-MM-DD y DD/MM/AAAA, y rechaza fechas que no existen como 31/02. */
export function parseImportDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (!iso && !local) return null;
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : [local![3], local![2], local![1]];
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

/** Sin separador de miles: "1.234" en cajas se rechaza por no ser entera, en vez de leerse como 1234 o 1,234 a ciegas. */
export function parseImportQuantity(text: string): number | null {
  if (!/^\d+([.,]\d+)?$/.test(text)) return null;
  const quantity = Number(text.replace(",", "."));
  return quantity <= 1_000_000_000 ? quantity : null;
}

// Caracteres que aceptan los nombres de Item y Batch de ERPNext sin sorpresas.
const CODE = /^[A-Za-z0-9][A-Za-z0-9._/ -]{0,139}$/;

export function validateRows(rows: RawImportRow[], today = argentinaToday()): { valid: ImportRow[]; errors: ImportRowError[] } {
  const parsed = rows.map(({ rowNumber, values }) => {
    const messages: string[] = [];
    if (!values.product) messages.push("Falta el producto.");
    else if (values.product.length > 200) messages.push("El producto supera los 200 caracteres.");
    if (!CODE.test(values.sku)) messages.push(values.sku ? "SKU inválido: usá letras, números, punto, guion o barra." : "Falta el SKU.");
    const unit = parseUnit(values.unit);
    if (!unit) messages.push(values.unit ? `Unidad «${values.unit}» inválida: usá unidades, cajas o kilogramos.` : "Falta la unidad.");
    if (!CODE.test(values.lot)) messages.push(values.lot ? "Lote inválido: usá letras, números, punto, guion o barra." : "Falta el lote.");
    const expiration = parseImportDate(values.expiration);
    if (!expiration) messages.push(values.expiration ? "Vencimiento inválido: usá DD/MM/AAAA." : "Falta el vencimiento.");
    else if (expiration < today) messages.push("El lote ya está vencido.");
    const warehouse = values.warehouse.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(warehouse)) messages.push(values.warehouse ? "Código de depósito inválido." : "Falta el depósito.");
    const quantity = parseImportQuantity(values.quantity);
    if (quantity === null || (unit && !isValidQuantity(quantity, unit)) || quantity <= 0) {
      messages.push(unit === "kilogramos" ? "Cantidad inválida: mayor a 0 y hasta dos decimales." : "Cantidad inválida: debe ser un entero mayor a 0, sin separador de miles.");
    }
    return { rowNumber, messages, row: { row: rowNumber, product: values.product, sku: values.sku, unit, lot: values.lot, expiration, warehouse, quantity } };
  });

  // Contra las filas anteriores del archivo; una fila inválida no define a las siguientes.
  const products = new Map<string, { row: number; unit: string; name: string }>();
  const lots = new Map<string, { row: number; expiration: string }>();
  const stock = new Map<string, number>();
  for (const { messages, row } of parsed) {
    if (messages.length) continue;
    const sku = row.sku.toLowerCase(), lot = `${sku}|${row.lot.toLowerCase()}`, line = `${lot}|${row.warehouse}`;
    const product = products.get(sku), knownLot = lots.get(lot), duplicate = stock.get(line);
    if (duplicate) messages.push(`Fila duplicada: el mismo SKU, lote y depósito ya está en la fila ${duplicate}.`);
    if (product && product.unit !== row.unit) messages.push(`El SKU tiene otra unidad en la fila ${product.row}.`);
    if (product && product.name !== row.product) messages.push(`El SKU tiene otro nombre de producto en la fila ${product.row}.`);
    if (knownLot && knownLot.expiration !== row.expiration) messages.push(`El lote tiene otro vencimiento en la fila ${knownLot.row}.`);
    if (messages.length) continue;
    products.set(sku, { row: row.row, unit: row.unit!, name: row.product });
    lots.set(lot, { row: row.row, expiration: row.expiration! });
    stock.set(line, row.row);
  }
  return {
    valid: parsed.filter(item => !item.messages.length).map(item => item.row as ImportRow),
    errors: parsed.filter(item => item.messages.length).map(item => ({ row: item.rowNumber, messages: item.messages })),
  };
}

/** Lo que devuelve import_stock_rows para una fila que no entra. */
export const IMPORT_STATUS_MESSAGES: Record<string, string> = {
  invalid_row: "La fila no tiene un formato válido.",
  warehouse_not_found: "El depósito no existe o está inactivo en TrazFlow.",
  warehouse_not_mapped: "El depósito no está vinculado a ningún depósito del ERP.",
  erp_managed: "Este producto o lote viene del ERP y no se puede cargar acá.",
  unit_mismatch: "El SKU ya existe con otra unidad.",
  expiration_mismatch: "El lote ya existe con otro vencimiento.",
  already_has_stock: "Este lote ya tiene stock o una importación en ese depósito.",
  write_failed: "No se pudo guardar la fila.",
};

export type ImportPreview = {
  fileName: string; mode: "erp" | "manual"; total: number; validCount: number;
  errors: ImportRowError[]; sample: ImportRow[];
};
export type ImportResult = {
  mode: "erp" | "manual"; total: number; imported: number; errors: ImportRowError[];
  /** Filas que no llegaron a procesarse por una falla general: reintentar es seguro. */
  unprocessed: number;
};
