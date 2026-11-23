import assert from "node:assert/strict";
import { test } from "vitest";

import {
  OdooClient,
  aggregateOdooQuants,
  odooDatetimeToDate,
  odooDatetimeToIso,
  type OdooLot,
  type OdooProduct,
  type OdooQuant,
  type OdooWarehouse,
} from "./odoo-client.ts";
import { ERP_CONTRACT_VERSION, ErpError } from "./types.ts";

const NOW = new Date("2026-11-21T15:00:00.000Z");
const API_KEY = "the-odoo-key";

/* ---------- Fixtures con la forma de search_read de Odoo 19 ---------- */

const WAREHOUSES: OdooWarehouse[] = [
  { id: 1, name: "Depósito Central", active: true, write_date: "2026-11-01 12:00:00" },
  { id: 2, name: "Depósito Norte", active: false, write_date: "2026-11-02 08:30:00" },
];

const PRODUCTS: OdooProduct[] = [
  { id: 10, default_code: "ACE-500", name: "Aceite de girasol 500 ml", uom_id: [1, "Units"], tracking: "lot", active: true, write_date: "2026-11-03 10:00:00" },
  { id: 11, default_code: false, name: "Harina 000 granel", uom_id: [12, "kg"], tracking: "none", active: false, write_date: "2026-11-04 10:00:00" },
];

const LOTS: OdooLot[] = [
  // 2027-03-31 00:00 en Argentina = 03:00 UTC.
  { id: 100, name: "L-2026-0915", product_id: [10, "[ACE-500] Aceite de girasol 500 ml"], expiration_date: "2027-03-31 03:00:00", write_date: "2026-11-05 09:00:00" },
  { id: 101, name: "L-2026-0921", product_id: [10, "[ACE-500] Aceite de girasol 500 ml"], expiration_date: false, write_date: "2026-11-05 09:05:00" },
];

const QUANTS: OdooQuant[] = [
  // Dos ubicaciones del Depósito Central (WH/Stock y WH/Stock/Estante 1) con el mismo lote: se suman.
  { id: 1000, product_id: [10, "ACE-500"], lot_id: [100, "L-2026-0915"], warehouse_id: [1, "WH"], quantity: 100, product_uom_id: [1, "Units"] },
  { id: 1001, product_id: [10, "ACE-500"], lot_id: [100, "L-2026-0915"], warehouse_id: [1, "WH"], quantity: 20, product_uom_id: [1, "Units"] },
  { id: 1003, product_id: [10, "ACE-500"], lot_id: [101, "L-2026-0921"], warehouse_id: [2, "NOR"], quantity: 30, product_uom_id: [1, "Units"] },
  // A mano 0 y ubicación interna fuera de un depósito: no se informan.
  { id: 1004, product_id: [10, "ACE-500"], lot_id: [101, "L-2026-0921"], warehouse_id: [1, "WH"], quantity: 0, product_uom_id: [1, "Units"] },
  { id: 1005, product_id: [10, "ACE-500"], lot_id: [101, "L-2026-0921"], warehouse_id: false, quantity: 5, product_uom_id: [1, "Units"] },
];

/** Un quant del producto 10 en el Depósito Central (WH) para armar los casos de suma. */
const quantWH = (id: number, lot: number, quantity: number): OdooQuant => ({
  id,
  product_id: [10, "ACE-500"],
  lot_id: [lot, `L-${lot}`],
  warehouse_id: [1, "WH"],
  quantity,
  product_uom_id: [1, "Units"],
});

/* ---------- Odoo falso ---------- */

type RpcCall = { service: string; method: string; args: unknown[] };
type ExecuteCall = { model: string; method: string; kwargs: Record<string, unknown> };
type Reply = { result: unknown } | { error: unknown } | { status: number } | Error;

function fakeOdoo(handler: (call: RpcCall) => Reply | undefined) {
  const calls: RpcCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    assert.equal(String(input), "http://odoo.example.com/jsonrpc");
    assert.equal(init.method, "POST");
    const body = JSON.parse(String(init.body)) as { id: number; params: RpcCall };
    calls.push(body.params);
    const reply = handler(body.params) ?? { error: { code: 200, message: "Odoo Server Error", data: { name: "builtins.KeyError" } } };
    if (reply instanceof Error) throw reply;
    if ("status" in reply) return new Response("<html>error</html>", { status: reply.status });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...reply }), { status: 200 });
  }) as typeof fetch;
  const client = new OdooClient(
    { baseUrl: "http://odoo.example.com/", database: "trazflow", username: "api@trazflow.local", apiKey: API_KEY, timeoutMs: 1000 },
    { fetch: fetchImpl, now: () => NOW },
  );
  const executes = () =>
    calls
      .filter((call) => call.service === "object")
      .map(({ args }) => ({ model: args[3], method: args[4], kwargs: args[6] }) as ExecuteCall);
  return { client, calls, executes };
}

/** Odoo 19 con stock y product_expiry: responde version, authenticate y search_read de los cuatro modelos. */
function odooWithData(overrides: { lotFields?: Record<string, unknown> } = {}) {
  const searchReads: Record<string, unknown[]> = {
    "stock.warehouse": WAREHOUSES,
    "product.product": PRODUCTS,
    "stock.lot": LOTS,
    "stock.quant": QUANTS,
  };
  return fakeOdoo(({ service, method, args }) => {
    if (service === "common" && method === "version") return { result: { server_version: "19.0", protocol_version: 1 } };
    if (service === "common" && method === "authenticate") return { result: 2 };
    if (service !== "object" || method !== "execute_kw") return undefined;
    const [, uid, key, model, modelMethod] = args as [string, number, string, string, string];
    assert.equal(uid, 2);
    assert.equal(key, API_KEY);
    if (modelMethod === "fields_get") return { result: overrides.lotFields ?? { name: { type: "char" }, expiration_date: { type: "datetime" } } };
    if (modelMethod === "search_read") {
      // Como Odoo: solo los campos pedidos.
      const fields = (args[6] as { fields: string[] }).fields;
      const rows = (searchReads[model] ?? []) as Record<string, unknown>[];
      return { result: rows.map((row) => Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, row[field]]))) };
    }
    return undefined;
  });
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: ErpError) => {
    assert.ok(error instanceof ErpError, String(error));
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    return true;
  });
}

/* ---------- healthcheck ---------- */

test("healthcheck pide la versión y autentica con base, usuario y API key", async () => {
  const { client, calls } = odooWithData();
  const health = await client.healthcheck();
  assert.deepEqual(health, { provider: "odoo", ok: true, latencyMs: health.latencyMs, checkedAt: NOW.toISOString() });
  assert.deepEqual(calls.map((call) => `${call.service}.${call.method}`), ["common.version", "common.authenticate"]);
  assert.deepEqual(calls[1].args, ["trazflow", "api@trazflow.local", API_KEY, {}]);
});

test("auth inválida (authenticate devuelve false con HTTP 200) es unauthorized sin filtrar la key", async () => {
  const { client } = fakeOdoo(({ method }) => (method === "version" ? { result: { server_version: "19.0" } } : { result: false }));
  await rejectsWith(client.healthcheck(), "unauthorized");
});

test("base inexistente (error de Postgres con HTTP 200, como responde Odoo 19) es unauthorized sin el host interno", async () => {
  const { client } = fakeOdoo(({ method }) => {
    if (method === "version") return { result: { server_version: "19.0" } };
    return {
      error: {
        code: 0,
        message: "Odoo Server Error",
        data: { name: "psycopg2.OperationalError", message: 'connection to server at "db" (172.19.0.2), port 5432 failed: FATAL:  database "nodb" does not exist\n' },
      },
    };
  });
  await assert.rejects(client.healthcheck(), (error: ErpError) => {
    assert.equal(error.code, "unauthorized");
    assert.equal(error.message, "Odoo no reconoce la base, el usuario o la API key configurados.");
    return true;
  });
});

test("AccessError en el cuerpo con HTTP 200 es unauthorized; el mensaje no trae traza ni la key", async () => {
  const { client } = fakeOdoo(({ method }) => {
    if (method === "authenticate") return { result: 2 };
    return {
      error: {
        code: 200,
        message: "Odoo Server Error",
        data: {
          name: "odoo.exceptions.AccessError",
          debug: `Traceback (most recent call last): args ${API_KEY}`,
          message: `No tenés permiso para leer <b>stock.quant</b> (${API_KEY})`,
        },
      },
    };
  });
  await assert.rejects(client.pullMasterData(), (error: ErpError) => {
    assert.equal(error.code, "unauthorized");
    assert.equal(error.message, "Odoo respondió con error: No tenés permiso para leer stock.quant (***)");
    assert.doesNotMatch(error.message, /Traceback|the-odoo-key/);
    return true;
  });
});

test("timeout, caída de red, HTTP 5xx y JSON-RPC mal formado se traducen al contrato", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  await rejectsWith(fakeOdoo(() => timeout).client.healthcheck(), "timeout");
  await rejectsWith(fakeOdoo(() => new TypeError("fetch failed")).client.healthcheck(), "network");
  await rejectsWith(fakeOdoo(() => ({ status: 502 })).client.healthcheck(), "unavailable");
  const noResult = fakeOdoo(() => ({ result: undefined }) as unknown as Reply);
  await rejectsWith(noResult.client.healthcheck(), "invalid_response");
});

/* ---------- pullMasterData ---------- */

test("pullMasterData traduce stock.warehouse, product.product, stock.lot y stock.quant al contrato", async () => {
  const { client, executes } = odooWithData();
  const data = await client.pullMasterData();
  assert.deepEqual(data, {
    contractVersion: ERP_CONTRACT_VERSION,
    fetchedAt: NOW.toISOString(),
    warehouses: [
      { externalId: "1", name: "Depósito Central", active: true, updatedAt: "2026-11-01T12:00:00.000Z" },
      { externalId: "2", name: "Depósito Norte", active: false, updatedAt: "2026-11-02T08:30:00.000Z" },
    ],
    products: [
      { externalId: "10", sku: "ACE-500", name: "Aceite de girasol 500 ml", uom: "Units", batchTracked: true, active: true, updatedAt: "2026-11-03T10:00:00.000Z" },
      { externalId: "11", sku: "11", name: "Harina 000 granel", uom: "kg", batchTracked: false, active: false, updatedAt: "2026-11-04T10:00:00.000Z" },
    ],
    lots: [
      { externalId: "100", productExternalId: "10", lotNumber: "L-2026-0915", manufacturingDate: null, expirationDate: "2027-03-31", active: true, updatedAt: "2026-11-05T09:00:00.000Z" },
      { externalId: "101", productExternalId: "10", lotNumber: "L-2026-0921", manufacturingDate: null, expirationDate: null, active: true, updatedAt: "2026-11-05T09:05:00.000Z" },
    ],
    stock: [
      { productExternalId: "10", lotExternalId: "100", warehouseExternalId: "1", quantity: 120, uom: "Units" },
      { productExternalId: "10", lotExternalId: "101", warehouseExternalId: "2", quantity: 30, uom: "Units" },
    ],
  });
  const reads = executes().filter((call) => call.method === "search_read");
  assert.deepEqual(reads.map((call) => call.model), ["stock.warehouse", "product.product", "stock.lot", "stock.quant"]);
  assert.deepEqual(reads[1].kwargs.domain, [["is_storable", "=", true]]);
  assert.deepEqual(reads[1].kwargs.context, { active_test: false });
  assert.ok((reads[2].kwargs.fields as string[]).includes("expiration_date"));
  assert.deepEqual(reads[3].kwargs.domain, [["location_id.usage", "=", "internal"], ["lot_id", "!=", false], ["product_id.tracking", "=", "lot"]]);
});

test("stock: suma la cantidad a mano por producto + lote + depósito y no informa saldos sin depósito o en 0", () => {
  assert.deepEqual(aggregateOdooQuants(QUANTS), [
    { productExternalId: "10", lotExternalId: "100", warehouseExternalId: "1", quantity: 120, uom: "Units" },
    { productExternalId: "10", lotExternalId: "101", warehouseExternalId: "2", quantity: 30, uom: "Units" },
  ]);
});

test("stock: primero suma todos los quants (también los negativos) y después descarta los saldos ≤ 0", () => {
  const balances = aggregateOdooQuants([
    // −5 y +10 en el mismo depósito: se informa 5 (no 10).
    quantWH(2000, 200, -5),
    quantWH(2001, 200, 10),
    // Saldo total −3: no se informa.
    quantWH(2002, 201, -3),
    // +4 y −4: saldo 0, no se informa.
    quantWH(2003, 202, 4),
    quantWH(2004, 202, -4),
    // Con decimales: 0,3 − 0,1 − 0,2 es 0 (no un resto de coma flotante) y no se informa.
    quantWH(2005, 203, 0.3),
    quantWH(2006, 203, -0.1),
    quantWH(2007, 203, -0.2),
  ]);
  assert.deepEqual(balances, [{ productExternalId: "10", lotExternalId: "200", warehouseExternalId: "1", quantity: 5, uom: "Units" }]);
});

test("stock: se pide la cantidad a mano (quantity), no la disponible", async () => {
  const { client, executes } = odooWithData();
  await client.pullMasterData();
  const quantRead = executes().find((call) => call.model === "stock.quant" && call.method === "search_read")!;
  const fields = quantRead.kwargs.fields as string[];
  assert.ok(fields.includes("quantity"));
  assert.ok(!fields.includes("available_quantity") && !fields.includes("reserved_quantity"));
});

test("updatedSince filtra productos y lotes por write_date en UTC; depósitos y stock vienen completos", async () => {
  const { client, executes } = odooWithData();
  await client.pullMasterData({ updatedSince: "2026-11-04T07:00:00-03:00" });
  const domains = Object.fromEntries(executes().filter((call) => call.method === "search_read").map((call) => [call.model, call.kwargs.domain]));
  assert.deepEqual(domains["stock.warehouse"], []);
  assert.deepEqual(domains["product.product"], [["is_storable", "=", true], ["write_date", ">=", "2026-11-04 10:00:00"]]);
  assert.deepEqual(domains["stock.lot"], [["product_id.tracking", "=", "lot"], ["write_date", ">=", "2026-11-04 10:00:00"]]);
  assert.equal((domains["stock.quant"] as unknown[]).length, 3);
  await rejectsWith(client.pullMasterData({ updatedSince: "ayer" }), "validation");
});

test("sin el módulo Fechas de vencimiento los lotes van con expirationDate null", async () => {
  const { client, executes } = odooWithData({ lotFields: { name: { type: "char" } } });
  const data = await client.pullMasterData();
  assert.ok(data.lots.every((lot) => lot.expirationDate === null));
  const lotRead = executes().find((call) => call.model === "stock.lot" && call.method === "search_read")!;
  assert.ok(!(lotRead.kwargs.fields as string[]).includes("expiration_date"));
});

test("fechas de Odoo (UTC) a ISO 8601 y vencimiento al día en hora argentina", () => {
  assert.equal(odooDatetimeToIso("2026-11-01 12:00:00"), "2026-11-01T12:00:00.000Z");
  assert.equal(odooDatetimeToDate("2027-03-31 03:00:00"), "2027-03-31");
  assert.equal(odooDatetimeToDate("2027-04-01 02:00:00"), "2027-03-31");
  assert.throws(() => odooDatetimeToIso("no es fecha"), (error: ErpError) => error.code === "invalid_response");
});

/* ---------- Operaciones no soportadas (una por test) ---------- */

const UNSUPPORTED = [
  "pullDispatchOrders",
  "reportDispatch",
  "getDispatchStatus",
  "reportDelivery",
  "attachDeliveryReceipt",
  "reportStockEntry",
  "reportStockImport",
  "reportPalletScan",
] as const;

for (const operation of UNSUPPORTED) {
  test(`${operation} no está soportado en Odoo: ErpError config sin llamar a la red`, async () => {
    const { client, calls } = odooWithData();
    await assert.rejects((client[operation] as () => Promise<unknown>)(), (error: ErpError) => {
      assert.ok(error instanceof ErpError);
      assert.equal(error.code, "config");
      assert.equal(error.message, "Odoo: operación no soportada todavía");
      return true;
    });
    assert.equal(calls.length, 0);
  });
}

test("getBatchPickingPolicy responde fifo sin llamar a la red", async () => {
  const { client, calls } = odooWithData();
  assert.equal(await client.getBatchPickingPolicy(), "fifo");
  assert.equal(calls.length, 0);
});
