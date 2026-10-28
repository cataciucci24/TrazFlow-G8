import assert from "node:assert/strict";
import { test } from "node:test";

import { warehouseErrorMessage } from "./errors.ts";

test("traduce los errores de depósito y deja pasar los demás", () => {
  assert.match(warehouseErrorMessage({ code: "TF110" }) ?? "", /no tiene depósitos/);
  assert.equal(warehouseErrorMessage({ code: "TF111" }), "Tu empresa tiene varios depósitos: elegí en cuál.");
  assert.match(warehouseErrorMessage({ code: "TF112" }) ?? "", /inactivo/);
  assert.match(warehouseErrorMessage({ code: "TF113" }) ?? "", /otro depósito/);
  assert.match(warehouseErrorMessage({ code: "23503", message: "El depósito NORTE no existe en tu empresa." }) ?? "", /no existe/);
  assert.match(warehouseErrorMessage({ code: "23503", message: 'violates foreign key constraint "pallets_warehouse_fkey"' }) ?? "", /no existe/);
  assert.equal(warehouseErrorMessage({ code: "23503", message: 'violates foreign key constraint "pallets_batch_id_fkey"' }), null);
  assert.equal(warehouseErrorMessage({ code: "TF100" }), null);
  assert.equal(warehouseErrorMessage(null), null);
});
