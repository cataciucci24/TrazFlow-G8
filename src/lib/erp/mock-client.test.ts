import assert from "node:assert/strict";
import { test } from "node:test";

import { MOCK_ERP_FIXTURES } from "./fixtures.ts";
import { MockErpClient } from "./mock-client.ts";
import { ERP_CONTRACT_VERSION, ErpError, buildDispatchIdempotencyKey, type DispatchReport } from "./types.ts";

const NOW = new Date("2026-10-15T15:00:00.000Z");

function client(options: ConstructorParameters<typeof MockErpClient>[0] = {}) {
  return new MockErpClient({ now: () => NOW, ...options });
}

function report(overrides: Partial<DispatchReport> = {}): DispatchReport {
  return {
    contractVersion: ERP_CONTRACT_VERSION,
    idempotencyKey: buildDispatchIdempotencyKey("SAL-ORD-2026-00012"),
    orderExternalId: "SAL-ORD-2026-00012",
    dispatchedAt: "2026-10-15T14:30:00.000Z",
    operator: { id: "user-1", name: "Operador Depósito" },
    lines: [
      { orderLineExternalId: "SAL-ORD-2026-00012-1", palletCode: "PAL-0001", productExternalId: "ACE-500", lotExternalId: "L-2026-0915", quantity: 45, uom: "Caja" },
      { orderLineExternalId: "SAL-ORD-2026-00012-1", palletCode: "PAL-0002", productExternalId: "ACE-500", lotExternalId: "L-2026-0921", quantity: 20, uom: "Caja" },
    ],
    ...overrides,
  };
}

async function rejectsWith(promise: Promise<unknown>, code: ErpError["code"], status: number | null = null) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ErpError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("pullMasterData devuelve los fixtures con la versión del contrato", async () => {
  const data = await client().pullMasterData();
  assert.equal(data.contractVersion, ERP_CONTRACT_VERSION);
  assert.equal(data.fetchedAt, NOW.toISOString());
  assert.deepEqual(data.products, MOCK_ERP_FIXTURES.products);
  assert.deepEqual(data.lots, MOCK_ERP_FIXTURES.lots);
  assert.deepEqual(data.stock, MOCK_ERP_FIXTURES.stock);
});

test("cada lote y cada stock apuntan a un producto existente por externalId", async () => {
  const data = await client().pullMasterData();
  const products = new Set(data.products.map((product) => product.externalId));
  const lots = new Map(data.lots.map((lot) => [lot.externalId, lot]));
  for (const lot of data.lots) assert.ok(products.has(lot.productExternalId), lot.externalId);
  for (const row of data.stock) {
    assert.ok(products.has(row.productExternalId));
    if (row.lotExternalId) assert.equal(lots.get(row.lotExternalId)?.productExternalId, row.productExternalId);
  }
});

test("updatedSince filtra productos y lotes pero no el stock", async () => {
  const data = await client().pullMasterData({ updatedSince: "2026-10-05T00:00:00Z" });
  assert.deepEqual(data.products.map((product) => product.externalId), ["QSO-HORMA", "SAL-FINA"]);
  assert.deepEqual(data.lots.map((lot) => lot.externalId), ["QSO-2026-1003"]);
  assert.equal(data.stock.length, MOCK_ERP_FIXTURES.stock.length);
});

test("pullDispatchOrders solo trae órdenes abiertas", async () => {
  const orders = await client().pullDispatchOrders();
  assert.deepEqual(orders.map((order) => order.externalId), ["SAL-ORD-2026-00012", "SAL-ORD-2026-00013"]);
});

test("los datos devueltos son copias: modificarlos no altera el mock", async () => {
  const erp = client();
  const orders = await erp.pullDispatchOrders();
  orders[0].status = "cancelled";
  assert.equal((await erp.pullDispatchOrders()).length, 2);
});

test("reportDispatch acepta el despacho y cierra la orden", async () => {
  const erp = client();
  const result = await erp.reportDispatch(report());
  assert.deepEqual(result, { erpReference: "MOCK-DN-0001", duplicate: false, acceptedAt: NOW.toISOString() });
  assert.deepEqual((await erp.pullDispatchOrders()).map((order) => order.externalId), ["SAL-ORD-2026-00013"]);
});

test("reintentar con la misma clave devuelve el mismo resultado marcado como duplicado", async () => {
  const erp = client();
  const first = await erp.reportDispatch(report());
  const second = await erp.reportDispatch(report());
  assert.equal(second.erpReference, first.erpReference);
  assert.equal(second.duplicate, true);
});

test("un payload que volvió de jsonb con otro orden de claves sigue siendo duplicado", async () => {
  const erp = client();
  const original = report();
  await erp.reportDispatch(original);
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(original).reverse()))) as DispatchReport;
  assert.equal((await erp.reportDispatch(reordered)).duplicate, true);
});

test("la misma clave con otro contenido es un conflicto", async () => {
  const erp = client();
  await erp.reportDispatch(report());
  await rejectsWith(erp.reportDispatch(report({ dispatchedAt: "2026-10-15T14:45:00.000Z" })), "conflict", 409);
});

test("errores de validación del ERP devuelven 422", async () => {
  await rejectsWith(client().reportDispatch(report({ orderExternalId: "NO-EXISTE", idempotencyKey: "dispatch:NO-EXISTE" })), "validation", 422);
  await rejectsWith(client().reportDispatch(report({ orderExternalId: "SAL-ORD-2026-00009", idempotencyKey: "dispatch:SAL-ORD-2026-00009" })), "validation", 422);
  const wrongLot = report();
  wrongLot.lines[0].lotExternalId = "ARR-2026-08";
  await rejectsWith(client().reportDispatch(wrongLot), "validation", 422);
});

test("un reporte mal formado se rechaza antes de llegar al ERP", async () => {
  await rejectsWith(client().reportDispatch(report({ lines: [] })), "validation");
  const repeated = report();
  repeated.lines[1].palletCode = repeated.lines[0].palletCode;
  await rejectsWith(client().reportDispatch(repeated), "validation");
});

test("escenarios permanentes: timeout, 401 y 500", async () => {
  await rejectsWith(client({ scenario: "timeout" }).healthcheck(), "timeout");
  await rejectsWith(client({ scenario: "unauthorized" }).pullMasterData(), "unauthorized", 401);
  await rejectsWith(client({ scenario: "server_error" }).pullDispatchOrders(), "unavailable", 500);
});

test("el escenario validation solo afecta al reporte de despacho", async () => {
  const erp = client({ scenario: "validation" });
  assert.equal((await erp.healthcheck()).ok, true);
  await rejectsWith(erp.reportDispatch(report()), "validation", 422);
});

test("fallas de una sola vez permiten probar reintentos", async () => {
  const erp = client({ failures: ["timeout", "server_error"] });
  await assert.rejects(erp.reportDispatch(report()), (error: ErpError) => error.retryable);
  await assert.rejects(erp.reportDispatch(report()), (error: ErpError) => error.retryable);
  const result = await erp.reportDispatch(report());
  assert.equal(result.duplicate, false);
});
