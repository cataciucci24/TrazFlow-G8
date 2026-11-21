import assert from "node:assert/strict";
import { test } from "node:test";

import { OdooClient } from "./odoo-client.ts";
import { ErpError } from "./types.ts";

const CONFIG = {
  baseUrl: "http://localhost:8069",
  database: "trazflow",
  username: "api@trazflow.local",
  apiKey: "the-key",
  timeoutMs: 1000,
};

test("ola 0: las operaciones de Odoo fallan con config sin llamar a la red, salvo la política de lotes", async () => {
  const fetchImpl = (async () => {
    throw new Error("no debería llamar a la red");
  }) as typeof fetch;
  const client = new OdooClient(CONFIG, { fetch: fetchImpl });
  const calls = [
    () => client.healthcheck(),
    () => client.pullMasterData(),
    () => client.pullDispatchOrders(),
    () => client.reportDispatch(),
    () => client.getDispatchStatus(),
    () => client.reportDelivery(),
    () => client.attachDeliveryReceipt(),
    () => client.reportStockEntry(),
    () => client.reportStockImport(),
    () => client.reportPalletScan(),
  ];
  for (const call of calls) {
    await assert.rejects(call(), (error: ErpError) => {
      assert.ok(error instanceof ErpError);
      assert.equal(error.code, "config");
      assert.equal(error.message, "Odoo: operación no soportada todavía");
      assert.doesNotMatch(error.message, /the-key/);
      return true;
    });
  }
  assert.equal(await client.getBatchPickingPolicy(), "fifo");
});
