import ExcelJS from "exceljs";

import { IMPORT_COLUMNS } from "./rows.ts";

/** Un .xlsx de 5.000 filas descomprimido ocupa unos pocos MB; más que esto es un archivo armado para agotar memoria. */
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;

/** Suma los tamaños que declara el índice del zip, sin descomprimir nada. Null si no es un zip legible. */
export function declaredZipSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const lowest = Math.max(0, end - 65_535);
  while (end >= lowest && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < lowest) return null;
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    total += view.getUint32(offset + 24, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return total;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value);
  if ("richText" in value) return value.richText.map(part => part.text).join("");
  if ("text" in value) return cellText(value.text as ExcelJS.CellValue);
  if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  return "";
}

export async function parseXlsx(bytes: Uint8Array): Promise<{ rowNumber: number; cells: string[] }[] | null> {
  const size = declaredZipSize(bytes);
  if (size === null || size > MAX_UNZIPPED_BYTES) return null;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  const rows: { rowNumber: number; cells: string[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // row.values empieza en el índice 1.
    rows.push({ rowNumber, cells: (row.values as ExcelJS.CellValue[]).slice(1).map(value => cellText(value)) });
  });
  return rows;
}

export async function buildImportTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stock");
  sheet.columns = IMPORT_COLUMNS.map(column => ({ header: column.header, width: column.key === "product" ? 36 : 16 }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const help = workbook.addWorksheet("Instrucciones");
  help.getColumn(1).width = 100;
  help.addRows([
    ["Completá la hoja Stock, sin cambiar los encabezados. Una fila por producto, lote y depósito. Hasta 5.000 filas."],
    ["Producto: nombre del producto."],
    ["SKU: letras, números, punto, guion o barra. Mismo SKU, mismo producto y unidad en todas sus filas."],
    ["Unidad: unidades, cajas o kilogramos."],
    ["Lote: número de lote. Mismo lote, mismo vencimiento en todas sus filas."],
    ["Vencimiento: fecha DD/MM/AAAA, hoy o posterior."],
    ["Depósito: código del depósito en TrazFlow, por ejemplo DEP-01."],
    ["Cantidad: mayor a 0, sin separador de miles. Entera, salvo en kilogramos (hasta dos decimales)."],
  ]);
  return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}
