import assert from "node:assert/strict";
import test from "node:test";

import { normalizePalletStatus } from "./status.ts";

test("unifica los estados históricos de recepción con los de entrega", () => {
  assert.equal(normalizePalletStatus("received"), "delivered");
  assert.equal(normalizePalletStatus("discrepancy"), "delivery_discrepancy");
  assert.equal(normalizePalletStatus("delivered"), "delivered");
});
