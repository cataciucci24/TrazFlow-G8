import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, toRawRows, validateRows, type RawImportRow } from "../../src/lib/stock-import/rows";

const today = "2026-11-22";
const row = (values: Partial<RawImportRow["values"]> = {}, rowNumber = 7): RawImportRow => ({
  rowNumber, values: { product: "Aceite", sku: "ACE-500", unit: "cajas", lot: "L1", expiration: "2027-12-31", warehouse: "DEP-01", quantity: "10", ...values },
});

describe("reglas de importación de TrazFlow", () => {
  it.each([
    [{ product: "" }, "Falta el producto"], [{ product: "a".repeat(201) }, "200 caracteres"],
    [{ sku: "" }, "Falta el SKU"], [{ sku: "A<B>" }, "SKU inválido"],
    [{ lot: "" }, "Falta el lote"], [{ lot: "L@1" }, "Lote inválido"],
    [{ unit: "litros" }, "Unidad"], [{ expiration: "31/02/2027" }, "Vencimiento inválido"],
    [{ expiration: "2026-11-21" }, "vencido"], [{ warehouse: "D/1" }, "depósito inválido"],
    [{ quantity: "0" }, "Cantidad inválida"], [{ quantity: "-1" }, "Cantidad inválida"],
    [{ quantity: "1.234" }, "Cantidad inválida"], [{ quantity: "1.2" }, "Cantidad inválida"],
    [{ quantity: "1000000001" }, "Cantidad inválida"], [{ unit: "kg", quantity: "1.234" }, "dos decimales"],
  ] as const)("rechaza %j: %s", (values, message) => {
    const result = validateRows([row(values)], today);
    expect(result.valid).toEqual([]);
    expect(result.errors[0].row).toBe(7);
    expect(result.errors[0].messages.join(" ")).toContain(message);
  });

  it.each(["unidades", "unidad", "un", "cajas", "caja", "kilogramos", "kilogramo", "kg", "kgs", "kilo", "kilos"])("acepta unidad o alias %s", unit => {
    expect(validateRows([row({ unit })], today).errors).toEqual([]);
  });
  it.each(["2027-12-31", "31/12/2027", today])("acepta fecha real no vencida %s", expiration => {
    expect(validateRows([row({ expiration })], today).valid).toHaveLength(1);
  });
  it("acepta los límites de producto y cantidad y normaliza el depósito", () => {
    const result = validateRows([row({ product: "a".repeat(200), quantity: "1000000000", warehouse: "dep-01" })], today);
    expect(result.valid[0]).toMatchObject({ quantity: 1_000_000_000, warehouse: "DEP-01" });
  });
  it("devuelve todos los errores con la fila original de Excel", () => {
    const result = validateRows([row({ product: "", sku: "", lot: "", unit: "", expiration: "", warehouse: "", quantity: "" }, 12)], today);
    expect(result.errors[0].row).toBe(12);
    expect(result.errors[0].messages).toHaveLength(7);
  });
  it("rechaza duplicados sin distinguir mayúsculas y conserva la primera fila válida", () => {
    const result = validateRows([row({}, 2), row({ sku: "ace-500", lot: "l1", warehouse: "dep-01" }, 3)], today);
    expect(result.valid.map(item => item.row)).toEqual([2]);
    expect(result.errors[0].messages[0]).toMatch(/duplicada.*fila 2/);
  });
  it("rechaza el archivo vacío y enumera las columnas ausentes", () => {
    expect(toRawRows([])).toEqual({ error: "El archivo está vacío." });
    expect(toRawRows([{ rowNumber: 1, cells: ["Producto"] }])).toEqual({ error: "Faltan columnas: SKU, Unidad, Lote, Vencimiento, Depósito, Cantidad. Usá la plantilla." });
  });
  it("acepta encabezados reordenados con tildes y mayúsculas distintas", () => {
    const result = toRawRows([{ rowNumber: 1, cells: ["CANTIDAD", "DEPÓSITO", "Vencimiento", "Lote", "Unidad", "sku", "producto"] }, { rowNumber: 9, cells: ["10", "D", "2027-01-01", "L", "un", "S", "P"] }]);
    expect(result).toMatchObject({ rows: [{ rowNumber: 9, values: { product: "P", quantity: "10" } }] });
  });
  it("rechaza más de 5.000 filas", () => {
    const header = ["Producto", "SKU", "Unidad", "Lote", "Vencimiento", "Depósito", "Cantidad"];
    const result = toRawRows([{ rowNumber: 1, cells: header }, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ rowNumber: i + 2, cells: ["P"] }))]);
    expect(result).toHaveProperty("error", "El archivo tiene 5001 filas y el máximo es 5000.");
  });
});
