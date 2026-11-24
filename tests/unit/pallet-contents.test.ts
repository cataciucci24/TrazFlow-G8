import { describe, expect, it } from "vitest";
import { attachExpectedPalletContents, attachPalletContents, getPalletContents, type RawPalletContent } from "../../src/lib/pallets/contents.ts";
import { mapPalletRow } from "../../src/lib/pallets/mapping.ts";
import { validPalletItems } from "../../src/lib/pallets/item-input.ts";
import { palletLabelContent } from "../../src/lib/pallet-labels/selection.ts";

function content(overrides: Partial<RawPalletContent> = {}): RawPalletContent {
  return { item_id: "i1", pallet_id: "p1", company_id: "c1", batch_id: "b1", batch_number: "L1", expiration_date: null,
    product_id: "prod1", product_name: "Arroz", product_sku: "ARZ", unit_of_measure: "cajas", quantity: 10, lot_source_system: "trazflow", ...overrides };
}

function database(rows: RawPalletContent[], error: unknown = null) {
  const calls: { ids: string[]; offset: number }[] = [];
  return { calls, from(table: string) {
    expect(table).toBe("pallet_contents");
    let ids: string[] = [];
    const query = {
      select: () => query, eq: () => query, in: (_field: string, values: string[]) => { ids = values; return query; }, order: () => query,
      range: (offset: number, end: number) => { calls.push({ ids, offset }); return Promise.resolve({ data: rows.filter((row) => ids.includes(row.pallet_id)).slice(offset, end + 1), error }); },
    };
    return query;
  } };
}

describe("contenido canónico de pallets", () => {
  it("no consulta una selección vacía y deduplica ids", async () => {
    const db = database([content()]);
    expect((await getPalletContents(db, [])).size).toBe(0);
    expect(db.calls).toEqual([]);
    expect((await getPalletContents(db, ["p1", "p1"])).get("p1")).toHaveLength(1);
    expect(db.calls[0].ids).toEqual(["p1"]);
  });

  it("pagina muchos ítems y divide selecciones grandes sin perder pallets", async () => {
    const db = database([
      ...Array.from({ length: 501 }, (_, index) => content({ item_id: `i${index}` })),
      ...Array.from({ length: 100 }, (_, index) => content({ pallet_id: `p${index + 2}`, item_id: `other${index}` })),
    ]);
    const result = await getPalletContents(db, Array.from({ length: 101 }, (_, index) => `p${index + 1}`));
    expect(result.get("p1")).toHaveLength(501);
    expect(result.get("p101")).toHaveLength(1);
    expect(db.calls.some((call) => call.offset === 500)).toBe(true);
    expect(db.calls.every((call) => call.ids.length <= 100)).toBe(true);
  });

  it("conserva cantidades desconocidas, pesos decimales y pallets sin contenido visible", async () => {
    const db = database([content({ quantity: null }), content({ item_id: "i2", unit_of_measure: "kilogramos", quantity: 2.5 })]);
    const rows = await attachPalletContents(db, [{ id: "p1" }, { id: "hidden" }]);
    expect(rows[0].contents.map((item) => item.quantity)).toEqual([null, 2.5]);
    expect(rows[1].contents).toEqual([]);
  });

  it("un fallo de lectura no se presenta como contenido vacío", async () => {
    await expect(getPalletContents(database([], { code: "42501" }), ["p1"])).rejects.toThrow("No se pudo consultar");
  });

  it("dos órdenes del mismo pallet conservan sus cantidades originales después de un reingreso", async () => {
    const db = { from: () => {
      const query = { select: () => query, in: () => query, order: () => query,
        range: async () => ({ error: null, data: [{ id: "b1", company_id: "c1", batch_number: "L1", expiration_date: null, source_system: "trazflow",
          products: [{ id: "prod1", name: "Arroz", sku: "ARZ", unit_of_measure: "cajas" }] }] }),
      };
      return query;
    } };
    const rows = await attachExpectedPalletContents(db, [
      { order_id: "old", pallet_id: "p1", expected_items: [{ productId: "prod1", batchId: "b1", quantity: 10 }] },
      { order_id: "new", pallet_id: "p1", expected_items: [{ productId: "prod1", batchId: "b1", quantity: 7 }] },
    ]);
    expect(rows.map((row) => [row.order_id, row.contents[0].quantity])).toEqual([["old", 10], ["new", 7]]);
  });

  it("un mixto conserva los ítems y un único QR, sin sumar cajas con kilogramos", async () => {
    const [row] = await attachPalletContents(database([content(), content({ item_id: "i2", batch_id: "b2", product_sku: "QSO", quantity: 2.5, unit_of_measure: "kilogramos" })]), [
      { id: "p1", qr_code: "PAL-MIX", status: "in_warehouse" as const, created_at: "2026-11-22T12:00:00Z", current_location: "Depósito" },
    ]);
    const pallet = mapPalletRow(row);
    expect(pallet.contents).toHaveLength(2);
    expect(pallet.quantity).toBeNull();
    expect(pallet.productName).toMatch(/mixto/);
    expect(palletLabelContent(pallet).qrValue).toBe("PAL-MIX");
    expect(palletLabelContent(pallet).batch).toMatch(/2 ítems/);
  });
});

describe("entrada de ítems", () => {
  const batch = "11100000-0000-0000-0000-000000000031";
  it("no rechaza kilos grandes con dos decimales por error binario", () => {
    expect(validPalletItems([{ batch_id: batch, quantity: 1234567.89 }])).toBe(true);
    expect(validPalletItems([{ batch_id: batch, quantity: 1234567.891 }])).toBe(false);
  });
  it("rechaza arrays con posiciones vacías", () => {
    expect(validPalletItems(new Array(1))).toBe(false);
  });
  it("acepta uno o varios lotes y valida cantidades finitas", () => {
    expect(validPalletItems([{ batch_id: batch, quantity: 2.5 }])).toBe(true);
    for (const quantity of [0, -1, NaN, Infinity, 1.001, "2"]) expect(validPalletItems([{ batch_id: batch, quantity }])).toBe(false);
  });
  it("rechaza lotes repetidos, ids inválidos, vacíos y más de cien ítems", () => {
    expect(validPalletItems([])).toBe(false);
    expect(validPalletItems([{ batch_id: "otro", quantity: 1 }])).toBe(false);
    expect(validPalletItems([{ batch_id: batch, quantity: 1 }, { batch_id: batch, quantity: 2 }])).toBe(false);
    expect(validPalletItems(Array.from({ length: 101 }, () => ({ batch_id: batch, quantity: 1 })))).toBe(false);
  });
});
