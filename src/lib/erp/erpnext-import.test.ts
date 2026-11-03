import assert from "node:assert/strict";
import { test } from "node:test";

import { ErpNextClient } from "./erpnext-client.ts";
import { MockErpClient } from "./mock-client.ts";
import { ERP_CONTRACT_VERSION, ErpError, type StockImportReport } from "./types.ts";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const ENTRY: StockImportReport = {
  contractVersion: ERP_CONTRACT_VERSION,
  idempotencyKey: "stock-import:10000000-0000-4000-8000-000000000001:2",
  sku: "ACE-500", productName: "Aceite", lotNumber: "L1", expirationDate: "2030-01-31",
  warehouseExternalId: "Central - SRV", quantity: 12, uom: "Caja",
  requestedAt: NOW.toISOString(), requestedBy: { id: "u1", name: "Logística" },
};

type Call = { method: string; path: string; json: Record<string, unknown> };
type Docs = Partial<Record<"Item" | "Batch" | "UOM" | "Stock Entry", unknown[]>>;

/** ERPNext en memoria: los POST agregan al listado, salvo los que indique `failPost`. */
function fakeErp(docs: Docs = {}, failPost?: (call: Call) => { status: number; body?: unknown } | undefined, itemGroup?: string) {
  const calls: Call[] = [];
  const store: Record<string, unknown[]> = { "Item Group": [{ name: "Productos" }], Warehouse: [], ...docs };
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    const doctype = path.replace("/api/resource/", "");
    const call: Call = { method: init.method ?? "GET", path, json: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    if (call.method === "POST") {
      const failure = failPost?.(call);
      if (failure) return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
      store[doctype] = [...(store[doctype] ?? []), { name: call.json.item_code ?? call.json.batch_id ?? call.json.uom_name ?? "STE-1", stock_uom: call.json.stock_uom, has_batch_no: call.json.has_batch_no, item: call.json.item, expiry_date: call.json.expiry_date }];
      return new Response(JSON.stringify({ data: { name: doctype === "Stock Entry" ? "STE-1" : "x" } }));
    }
    if (doctype === "Warehouse/Central - SRV") return new Response(JSON.stringify({ data: { company: "SRV" } }));
    return new Response(JSON.stringify({ data: store[doctype] ?? [] }));
  }) as typeof fetch;
  const client = new ErpNextClient({ baseUrl: "https://erp.example.com", apiKey: "k", apiSecret: "s", timeoutMs: 1000, fetch: fetchImpl, now: () => NOW, itemGroup });
  return { client, calls, posts: () => calls.filter(call => call.method === "POST") };
}
const ITEM = { name: "ACE-500", stock_uom: "Caja", has_batch_no: 1 };
const BATCH = { name: "L1", item: "ACE-500", expiry_date: "2030-01-31" };
const assertValidation = (pattern: RegExp) => (error: unknown) =>
  error instanceof ErpError && error.code === "validation" && !error.retryable && pattern.test(error.message);

test("crea unidad, producto y lote faltantes y deja el Stock Entry en borrador", async () => {
  const { client, posts } = fakeErp();
  const result = await client.reportStockImport(ENTRY);
  assert.deepEqual(result, { erpReference: "STE-1", duplicate: false, acceptedAt: NOW.toISOString() });
  assert.deepEqual(posts().map(call => call.path.replace("/api/resource/", "")), ["UOM", "Item", "Batch", "Stock Entry"]);
  const [, item, batch, entry] = posts();
  assert.deepEqual(item.json, { item_code: "ACE-500", item_name: "Aceite", item_group: "Productos", stock_uom: "Caja", is_stock_item: 1, has_batch_no: 1 });
  assert.deepEqual(batch.json, { batch_id: "L1", item: "ACE-500", expiry_date: "2030-01-31" });
  assert.equal(entry.json.stock_entry_type, "Material Receipt");
  assert.equal(entry.json.trazflow_idempotency_key, ENTRY.idempotencyKey);
  assert.equal("docstatus" in entry.json && entry.json.docstatus !== 0, false, "queda en borrador");
  const [line] = entry.json.items as Record<string, unknown>[];
  assert.deepEqual([line.item_code, line.batch_no, line.t_warehouse, line.qty, line.uom], ["ACE-500", "L1", "Central - SRV", 12, "Caja"]);
  assert.ok(!posts().some(call => call.path.includes("submit")));
});

test("ERP_ITEM_GROUP elige el grupo sin consultarlo", async () => {
  const { client, calls, posts } = fakeErp({ UOM: [{ name: "Caja" }] }, undefined, "Alimentos");
  await client.reportStockImport(ENTRY);
  assert.equal(posts()[0].json.item_group, "Alimentos");
  assert.ok(!calls.some(call => call.path.endsWith("/Item Group")));
});

test("lo que ya existe no se vuelve a crear", async () => {
  const { client, posts } = fakeErp({ Item: [ITEM], Batch: [BATCH] });
  await client.reportStockImport(ENTRY);
  assert.deepEqual(posts().map(call => call.path), ["/api/resource/Stock Entry"]);
});

test("reintentar un envío ya hecho no crea otro borrador", async () => {
  const { client, posts } = fakeErp({ Item: [ITEM], Batch: [BATCH], "Stock Entry": [{ name: "STE-9", creation: "2026-11-02 09:00:00.000000" }] });
  const result = await client.reportStockImport(ENTRY);
  assert.equal(result.duplicate, true);
  assert.equal(result.erpReference, "STE-9");
  assert.equal(posts().length, 0);
});

test("no pisa datos del ERP: conflictos definitivos con el motivo", async () => {
  await assert.rejects(fakeErp({ Item: [{ ...ITEM, stock_uom: "Kg" }] }).client.reportStockImport(ENTRY), assertValidation(/usa la unidad Kg/));
  await assert.rejects(fakeErp({ Item: [{ ...ITEM, has_batch_no: 0 }] }).client.reportStockImport(ENTRY), assertValidation(/sin control por lote/));
  await assert.rejects(fakeErp({ Item: [ITEM], Batch: [{ ...BATCH, item: "OTRO" }] }).client.reportStockImport(ENTRY), assertValidation(/para el producto OTRO/));
  await assert.rejects(fakeErp({ Item: [ITEM], Batch: [{ ...BATCH, expiry_date: "2031-01-01" }] }).client.reportStockImport(ENTRY), assertValidation(/otro vencimiento/));
  const noGroup = fakeErp({ UOM: [{ name: "Caja" }], "Item Group": [] } as Docs);
  await assert.rejects(noGroup.client.reportStockImport(ENTRY), assertValidation(/grupo de productos/));
});

test("si el ERP no responde el error es reintentable y el reintento retoma donde quedó", async () => {
  let down = true;
  const { client, posts } = fakeErp({}, call => (down && call.path.endsWith("/Batch") ? { status: 503 } : undefined));
  await assert.rejects(client.reportStockImport(ENTRY), (error: unknown) => error instanceof ErpError && error.retryable);
  down = false;
  await client.reportStockImport(ENTRY);
  assert.equal(posts().filter(call => call.path.endsWith("/Item")).length, 1);
  assert.equal(posts().filter(call => call.path.endsWith("/Stock Entry")).length, 1);
});

test("el payload se valida antes de tocar el ERP", async () => {
  const { client, calls } = fakeErp();
  await assert.rejects(client.reportStockImport({ ...ENTRY, expirationDate: "31/01/2030" }), assertValidation(/expirationDate/));
  await assert.rejects(client.reportStockImport({ ...ENTRY, idempotencyKey: "stock-entry:x" }), assertValidation(/idempotencyKey/));
  assert.equal(calls.length, 0);
});

test("mock: idempotente por clave y rechaza la misma clave con otro contenido", async () => {
  const client = new MockErpClient();
  const first = await client.reportStockImport(ENTRY);
  assert.equal(first.duplicate, false);
  assert.equal((await client.reportStockImport(ENTRY)).duplicate, true);
  await assert.rejects(client.reportStockImport({ ...ENTRY, quantity: 99 }), (error: unknown) => error instanceof ErpError && error.code === "conflict");
});
