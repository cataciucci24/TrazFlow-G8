import assert from "node:assert/strict";
import test from "node:test";
import { decodeCsv, parseCsv } from "./csv.ts";
import { MAX_IMPORT_ROWS, parseImportDate, parseImportQuantity, toRawRows, validateRows, type RawImportRow } from "./rows.ts";
import { buildImportTemplate, declaredZipSize, parseXlsx } from "./xlsx.ts";

const HEADER = "Producto;SKU;Unidad;Lote;Vencimiento;Depósito;Cantidad";
const raw = (over: Partial<RawImportRow["values"]> = {}, rowNumber = 2): RawImportRow => ({
  rowNumber,
  values: { product: "Aceite", sku: "ACE-500", unit: "cajas", lot: "L1", expiration: "31/12/2027", warehouse: "dep-01", quantity: "10", ...over },
});
const messagesOf = (over: Partial<RawImportRow["values"]>) => validateRows([raw(over)], "2026-11-01").errors[0]?.messages.join(" ") ?? "";

test("CSV: separador de Excel en español, comillas, BOM y número de fila real", () => {
  const text = decodeCsv(new TextEncoder().encode(`﻿${HEADER}\r\n"Aceite; ""premium"""; A;cajas;L;1/1/2030;D;3\r\n\r\nSal;S;kg;L;1/1/2030;D;"1,5"\r\n`));
  const rows = parseCsv(text);
  assert.deepEqual(rows[1], { rowNumber: 2, cells: ['Aceite; "premium"', " A", "cajas", "L", "1/1/2030", "D", "3"] });
  const result = toRawRows(rows);
  assert.ok("rows" in result);
  assert.equal(result.rows[1].rowNumber, 4);
  assert.equal(result.rows[1].values.quantity, "1,5");
});

test("CSV en Windows-1252 conserva los acentos", () => {
  assert.equal(decodeCsv(new Uint8Array([0x44, 0x65, 0x70, 0xf3, 0x73, 0x69, 0x74, 0x6f])), "Depósito");
});

test("encabezados en cualquier orden, sin acentos; faltantes y archivos vacíos se rechazan", () => {
  const ok = toRawRows([{ rowNumber: 1, cells: ["cantidad", "DEPOSITO", "vencimiento", "lote", "unidad", "sku", "producto"] }, { rowNumber: 2, cells: ["5", "D", "1/1/2030", "L", "cajas", "S", "P"] }]);
  assert.ok("rows" in ok);
  assert.equal(ok.rows[0].values.quantity, "5");
  assert.equal(ok.rows[0].values.product, "P");
  const missing = toRawRows([{ rowNumber: 1, cells: ["Producto", "SKU"] }, { rowNumber: 2, cells: ["a", "b"] }]);
  assert.ok("error" in missing && missing.error.includes("Cantidad"));
  assert.deepEqual(toRawRows([]), { error: "El archivo está vacío." });
  assert.deepEqual(toRawRows([{ rowNumber: 1, cells: HEADER.split(";") }]), { error: "El archivo no tiene filas para importar." });
});

test("hasta 5.000 filas exactas", () => {
  const table = (count: number) => [{ rowNumber: 1, cells: HEADER.split(";") }, ...Array.from({ length: count }, (_, index) => ({ rowNumber: index + 2, cells: ["P", "S", "cajas", "L", "1/1/2030", "D", "1"] }))];
  assert.ok("rows" in toRawRows(table(MAX_IMPORT_ROWS)));
  assert.ok("error" in toRawRows(table(MAX_IMPORT_ROWS + 1)));
});

test("fechas: formatos aceptados y fechas inexistentes", () => {
  assert.equal(parseImportDate("2027-02-28"), "2027-02-28");
  assert.equal(parseImportDate("5/3/2027"), "2027-03-05");
  for (const text of ["31/02/2027", "2027-13-01", "03-2027", "mañana", ""]) assert.equal(parseImportDate(text), null, text);
});

test("cantidad: un separador decimal, nunca miles adivinados", () => {
  assert.equal(parseImportQuantity("12,5"), 12.5);
  assert.equal(parseImportQuantity("1.234"), 1.234);
  for (const text of ["1.234,5", "-3", "1e3", "", "2000000000"]) assert.equal(parseImportQuantity(text), null, text);
  assert.match(messagesOf({ quantity: "1.234" }), /Cantidad inválida/);
  assert.match(messagesOf({ quantity: "1.234", unit: "kg" }), /dos decimales/);
  assert.equal(messagesOf({ quantity: "1.23", unit: "kg" }), "");
  assert.match(messagesOf({ quantity: "0" }), /Cantidad inválida/);
});

test("cada campo da su motivo y una fila mala no frena a las demás", () => {
  assert.match(messagesOf({ sku: "" }), /Falta el SKU/);
  assert.match(messagesOf({ sku: "A<B>" }), /SKU inválido/);
  assert.match(messagesOf({ unit: "litros" }), /«litros» inválida/);
  assert.match(messagesOf({ expiration: "31/02/2027" }), /Vencimiento inválido/);
  assert.match(messagesOf({ expiration: "31/10/2026" }), /ya está vencido/);
  assert.equal(messagesOf({ expiration: "01/11/2026" }), "");
  const all = messagesOf({ sku: "", lot: "", product: "", warehouse: "", unit: "", expiration: "", quantity: "" });
  for (const part of ["producto", "SKU", "unidad", "lote", "vencimiento", "depósito"]) assert.ok(all.includes(`Falta el ${part}`) || all.includes(`Falta la ${part}`), part);
  const { valid, errors } = validateRows([raw({ sku: "" }, 2), raw({}, 3)], "2026-11-01");
  assert.deepEqual(valid.map(row => row.row), [3]);
  assert.deepEqual(errors.map(error => error.row), [2]);
  assert.equal(valid[0].warehouse, "DEP-01");
  assert.equal(valid[0].expiration, "2027-12-31");
});

test("duplicados e inconsistencias dentro del archivo señalan la fila original", () => {
  const { valid, errors } = validateRows([
    raw({}, 2),
    raw({ sku: "ace-500", lot: "l1" }, 3),
    raw({ lot: "L2", unit: "kilogramos" }, 4),
    raw({ lot: "L3", product: "Otro" }, 5),
    raw({ warehouse: "DEP-02", expiration: "30/12/2027" }, 6),
    raw({ warehouse: "DEP-02" }, 7),
    raw({ lot: "L9", quantity: "x" }, 8),
    raw({ lot: "L9" , warehouse: "DEP-03" }, 9),
  ], "2026-11-01");
  assert.deepEqual(valid.map(row => row.row), [2, 7, 9]);
  assert.match(errors.find(error => error.row === 3)!.messages[0], /duplicada.*fila 2/);
  assert.match(errors.find(error => error.row === 4)!.messages[0], /otra unidad en la fila 2/);
  assert.match(errors.find(error => error.row === 5)!.messages[0], /otro nombre.*fila 2/);
  assert.match(errors.find(error => error.row === 6)!.messages[0], /otro vencimiento en la fila 2/);
});

test("la plantilla se puede leer y trae las columnas, sin filas de ejemplo", async () => {
  const table = await parseXlsx(await buildImportTemplate());
  assert.ok(table);
  assert.deepEqual(table[0].cells, HEADER.split(";"));
  assert.deepEqual(toRawRows(table), { error: "El archivo no tiene filas para importar." });
});

test("xlsx: texto, números, fechas y fórmulas se leen como las ve el usuario", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Stock").addRows([
    HEADER.split(";"),
    ["Aceite", 12345, "cajas", "L1", new Date(Date.UTC(2027, 11, 31)), "DEP-01", { formula: "5+5", result: 10 }],
  ]);
  const table = await parseXlsx(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer));
  assert.deepEqual(table![1], { rowNumber: 2, cells: ["Aceite", "12345", "cajas", "L1", "2027-12-31", "DEP-01", "10"] });
});

test("archivos que no son xlsx o declaran un tamaño abusivo se rechazan sin leerse", async () => {
  assert.equal(await parseXlsx(new TextEncoder().encode("no soy un zip")), null);
  const zip = new Uint8Array(await buildImportTemplate());
  assert.ok(declaredZipSize(zip)! > 0);
  const view = new DataView(zip.buffer);
  let end = zip.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  view.setUint32(view.getUint32(end + 16, true) + 24, 0xffffffff, true);
  assert.equal(await parseXlsx(zip), null);
});
