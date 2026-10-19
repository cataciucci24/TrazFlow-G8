import assert from "node:assert/strict";
import { test } from "node:test";

import { configuredErpProvider, isErpEnabled } from "./enabled.ts";

test("sin ERP_PROVIDER explícito la empresa no trabaja con ERP", async () => {
  assert.equal(await isErpEnabled("company", {}), false);
  assert.equal(await isErpEnabled("company", { ERP_PROVIDER: "  " }), false);
});

test("con ERP_PROVIDER definido la empresa trabaja con ERP", async () => {
  assert.equal(await isErpEnabled("company", { ERP_PROVIDER: "mock" }), true);
  assert.equal(await isErpEnabled("company", { ERP_PROVIDER: "erpnext" }), true);
});

test("el proveedor auditado se recorta y nunca queda vacío", () => {
  assert.equal(configuredErpProvider({ ERP_PROVIDER: " erpnext " }), "erpnext");
  assert.equal(configuredErpProvider({}), "mock");
  assert.equal(configuredErpProvider({ ERP_PROVIDER: "x".repeat(80) }).length, 40);
});
