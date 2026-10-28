import assert from "node:assert/strict";
import { test } from "node:test";

import { canBuildFrom, formatStockQuantity, toErpStockRow } from "./types.ts";

test("solo se arma de lotes activos con disponible", () => {
  assert.equal(canBuildFrom({ lotActive: true, productActive: true, available: 55 }), true);
  assert.equal(canBuildFrom({ lotActive: true, productActive: true, available: 0 }), false);
  assert.equal(canBuildFrom({ lotActive: false, productActive: true, available: 10 }), false);
  assert.equal(canBuildFrom({ lotActive: true, productActive: false, available: 10 }), false);
});

test("cantidades en castellano", () => {
  assert.equal(formatStockQuantity(356.5, "kilogramos"), "356,5 kilogramos");
  assert.equal(formatStockQuantity(1, "unidades"), "1 unidad");
});

test("mapea la fila de erp_stock_overview (numeric llega como string o número)", () => {
  const row = toErpStockRow({
    batch_id: "b1", batch_number: "L-1", expiration_date: "2027-03-31", lot_active: true, product_id: "p1",
    product_name: "Aceite", product_sku: "ACE-500", unit_of_measure: "cajas", product_active: true, warehouse_code: "DEP-01",
    erp_quantity: "120", built: 65, dispatched_pending: "0", available: "55", oldest_synced_at: "2026-10-27T18:00:00Z",
    document_label: null, awaiting_quantity: 0, awaiting_references: [],
  });
  assert.equal(row.erpQuantity, 120);
  assert.equal(row.available, 55);
  assert.equal(row.dispatchedPending, 0);
  assert.equal("documentLabel" in row, false, "el estado del remito no llega a la app");
});
