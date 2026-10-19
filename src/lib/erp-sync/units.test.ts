import assert from "node:assert/strict";
import { test } from "node:test";

import { MOCK_ERP_FIXTURES } from "../erp/fixtures.ts";
import { mapErpUnit } from "./units.ts";

test("traduce las unidades del ERP a las de TrazFlow", () => {
  assert.equal(mapErpUnit("Caja"), "cajas");
  assert.equal(mapErpUnit(" kg. "), "kilogramos");
  assert.equal(mapErpUnit("Kilogramo"), "kilogramos");
  assert.equal(mapErpUnit("Unidad"), "unidades");
  assert.equal(mapErpUnit("Nos"), "unidades");
  assert.equal(mapErpUnit("Box"), "cajas");
});

test("una unidad desconocida no se adivina", () => {
  assert.equal(mapErpUnit("Bolsa"), null);
  assert.equal(mapErpUnit(""), null);
  assert.equal(mapErpUnit(null), null);
});

test("todas las unidades de los fixtures del mock tienen equivalente", () => {
  for (const product of MOCK_ERP_FIXTURES.products) assert.ok(mapErpUnit(product.uom), product.uom);
  for (const balance of MOCK_ERP_FIXTURES.stock) assert.ok(mapErpUnit(balance.uom), balance.uom);
});
