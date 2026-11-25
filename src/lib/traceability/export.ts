import "server-only";

import ExcelJS from "exceljs";

import { TIMELINE_EXPORT_HEADERS, timelineExportRows, type TimelineEntry } from "@/lib/traceability/timeline";

/** TRZ-59: la línea de tiempo en un .xlsx, con un encabezado que dice de qué pallet o lote es. */
export async function buildTimelineWorkbook(title: string, details: string[], entries: TimelineEntry[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TrazFlow";
  const sheet = workbook.addWorksheet("Trazabilidad");

  sheet.addRow([title]).font = { bold: true, size: 14 };
  for (const line of details) sheet.addRow([line]);
  sheet.addRow([`Exportado el ${new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date())} (hora de Argentina)`]);
  sheet.addRow([]);

  const header = sheet.addRow([...TIMELINE_EXPORT_HEADERS]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F4" } };
  });
  for (const row of timelineExportRows(entries)) sheet.addRow(row);

  [20, 32, 36, 24, 44, 40].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
