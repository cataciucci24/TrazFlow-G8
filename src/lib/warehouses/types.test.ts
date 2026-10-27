import assert from "node:assert/strict";
import { test } from "node:test";

import { activeWarehouses, toWarehouse, warehouseLabel, type Warehouse } from "./types.ts";

const warehouse = (code: string, active = true): Warehouse => ({
  code, name: `Depósito ${code}`, externalId: null, sourceSystem: "trazflow", active, syncedAt: null,
});

test("toWarehouse mapea la fila de la base", () => {
  assert.deepEqual(
    toWarehouse({ code: "DEP-01", name: "Depósito Central", external_id: "Depósito Central - SRV", source_system: "erp", active: true, synced_at: "2026-10-29T12:00:00Z" }),
    { code: "DEP-01", name: "Depósito Central", externalId: "Depósito Central - SRV", sourceSystem: "erp", active: true, syncedAt: "2026-10-29T12:00:00Z" },
  );
});

test("warehouseLabel muestra código y nombre", () => {
  assert.equal(warehouseLabel({ code: "DEP-01", name: "Depósito Central" }), "DEP-01 · Depósito Central");
  assert.equal(warehouseLabel({ code: "DEP-01", name: "DEP-01" }), "DEP-01");
});

test("activeWarehouses deja solo los activos", () => {
  assert.deepEqual(activeWarehouses([warehouse("DEP-01"), warehouse("OLD", false)]).map((w) => w.code), ["DEP-01"]);
});
