import assert from "node:assert/strict";
import test from "node:test";
import { mapOrderPalletRows, mapPalletRow, PALLET_SELECT, type RawPalletRow } from "./mapping.ts";

const location = { warehouse_code: "DEP-01", code: "A01", aisle: "A", rack: "1", level: "1", position: "2" };

function row(overrides: Partial<RawPalletRow> = {}): RawPalletRow {
  return {
    id: "p1",
    qr_code: "PAL-001",
    status: "in_warehouse",
    current_location: "DEP-01 / A01",
    current_location_id: "loc-1",
    warehouse_code: "DEP-01",
    quantity: 10,
    created_at: "2026-10-28T10:00:00Z",
    location,
    batches: { batch_number: "L-1", products: { name: "Arroz", sku: "ARZ", unit_of_measure: "unidades" } },
    ...overrides,
  };
}

test("la query pide la ubicación por el FK de current_location_id", () => {
  assert.match(PALLET_SELECT, /location:warehouse_locations!pallets_company_location_fkey \( warehouse_code, code, aisle, rack, level, position \)/);
});

test("mapea la ubicación desde warehouse_locations, no desde el texto", () => {
  const pallet = mapPalletRow(row({ current_location: "texto viejo" }));
  assert.deepEqual(pallet.location, { warehouseCode: "DEP-01", code: "A01", aisle: "A", rack: "1", level: "1", position: "2" });
  assert.equal(pallet.productName, "Arroz");
});

test("sin ubicación (o sin permiso para verla por RLS) queda null", () => {
  assert.equal(mapPalletRow(row({ location: null, current_location_id: null })).location, null);
  assert.equal(mapPalletRow(row({ location: undefined })).location, null);
  assert.equal(mapPalletRow(row({ location: [] })).location, null);
});

test("los pallets de una orden aceptan el pallet embebido como objeto o array y descartan los vacíos", () => {
  const pallets = mapOrderPalletRows([
    { pallets: row({ id: "a" }) },
    { pallets: [row({ id: "b", location: [location] })] },
    { pallets: null },
  ]);
  assert.deepEqual(pallets.map((pallet) => pallet.id), ["a", "b"]);
  assert.equal(pallets[1].location?.code, "A01");
});
