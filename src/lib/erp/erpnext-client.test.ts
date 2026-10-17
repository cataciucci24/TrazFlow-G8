import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ErpNextClient,
  frappeDatetimeToIso,
  frappeErrorMessage,
  isoToFrappeDatetime,
  mapSalesOrderStatus,
  type ErpNextDeliveryNote,
  type ErpNextSalesOrder,
} from "./erpnext-client.ts";
import { ERP_CONTRACT_VERSION, ErpError, type DispatchReport } from "./types.ts";

const NOW = new Date("2026-10-15T15:00:00.000Z");

/* ---------- Fixtures con la forma de las respuestas de ERPNext v15 ---------- */

const ITEMS = [
  { name: "ACE-500", item_code: "ACE-500", item_name: "Aceite de girasol 500 ml", stock_uom: "Caja", has_batch_no: 1, disabled: 0, modified: "2026-10-01 09:00:00.000000" },
  { name: "SAL-FINA", item_code: "SAL-FINA", item_name: "Sal fina 500 g", stock_uom: "Unidad", has_batch_no: 0, disabled: 0, modified: "2026-10-02 10:30:00.000000" },
];

const BATCHES = [
  { name: "L-2026-0915", item: "ACE-500", manufacturing_date: "2026-09-15", expiry_date: "2027-03-31", disabled: 0, modified: "2026-10-01 09:05:00.000000" },
  { name: "L-2026-0921", item: "ACE-500", manufacturing_date: null, expiry_date: null, disabled: 1, modified: "2026-10-01 09:06:00.000000" },
];

const BATCH_QTY = [
  { batch_no: "L-2026-0915", warehouse: "Depósito Central - SRV", qty: 120 },
  { batch_no: "L-2026-0921", warehouse: "Depósito Central - SRV", qty: 0 },
];

const SALES_ORDER: ErpNextSalesOrder = {
  name: "SAL-ORD-2026-00012",
  customer: "CUST-NORTE",
  customer_name: "Distribuidora Norte",
  delivery_date: "2026-10-20",
  status: "To Deliver and Bill",
  docstatus: 1,
  per_delivered: 0,
  modified: "2026-10-10 09:00:00.000000",
  items: [{ name: "so-item-1", item_code: "ACE-500", stock_qty: 65, stock_uom: "Caja", warehouse: "Depósito Central - SRV" }],
};

const REPORT: DispatchReport = {
  contractVersion: ERP_CONTRACT_VERSION,
  idempotencyKey: "dispatch:SAL-ORD-2026-00012",
  orderExternalId: "SAL-ORD-2026-00012",
  dispatchedAt: "2026-10-15T14:30:00.000Z",
  operator: { id: "user-1", name: "Operador Depósito" },
  lines: [{ orderLineExternalId: "so-item-1", palletCode: "PAL-0001", productExternalId: "ACE-500", lotExternalId: "L-2026-0915", quantity: 45, uom: "Caja" }],
};

/* ---------- ERPNext falso ---------- */

type Call = { method: string; url: URL; headers: Headers; body: unknown };
type Reply = { status?: number; body?: unknown } | Error;
type Route = (call: Call) => Reply | undefined;

function fakeErp(...routes: Route[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    for (const route of routes) {
      const reply = route(call);
      if (reply instanceof Error) throw reply;
      if (reply) return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    }
    return new Response(JSON.stringify({ exc_type: "DoesNotExistError" }), { status: 404 });
  }) as typeof fetch;
  const client = new ErpNextClient({
    baseUrl: "https://erp.example.com/",
    apiKey: "the-key",
    apiSecret: "the-secret",
    timeoutMs: 1000,
    fetch: fetchImpl,
    now: () => NOW,
  });
  return { client, calls };
}

function on(method: string, path: string, reply: Reply | ((call: Call) => Reply)): Route {
  return (call) => {
    if (call.method !== method || decodeURIComponent(call.url.pathname) !== path) return undefined;
    return typeof reply === "function" ? reply(call) : reply;
  };
}

function filtersOf(call: Call): unknown[] {
  return JSON.parse(call.url.searchParams.get("filters") ?? "[]");
}

/** Remito que ERPNext guardó para REPORT (posting_time como lo devuelve Frappe, con microsegundos). */
const DELIVERY_NOTE: ErpNextDeliveryNote = {
  name: "MAT-DN-2026-00001",
  creation: "2026-10-15 11:31:00.000000",
  posting_date: "2026-10-15",
  posting_time: "11:30:00.000000",
  trazflow_operator: "Operador Depósito",
  items: [{ item_code: "ACE-500", qty: 45, uom: "Caja", batch_no: "L-2026-0915", trazflow_pallet_code: "PAL-0001" }],
};

const noDeliveryNote = on("GET", "/api/resource/Delivery Note", { body: { data: [] } });
const existingDeliveryNote = on("GET", "/api/resource/Delivery Note", {
  body: { data: [{ name: DELIVERY_NOTE.name, creation: DELIVERY_NOTE.creation }] },
});
const deliveryNote = (note: ErpNextDeliveryNote = DELIVERY_NOTE) =>
  on("GET", `/api/resource/Delivery Note/${note.name}`, { body: { data: note } });
const salesOrder = on("GET", "/api/resource/Sales Order/SAL-ORD-2026-00012", { body: { data: SALES_ORDER } });

async function rejectsWith(promise: Promise<unknown>, code: ErpError["code"], status: number | null = null) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ErpError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

/* ---------- Tests ---------- */

test("autentica con token api_key:api_secret y sin barra doble en la URL", async () => {
  const { client, calls } = fakeErp(on("GET", "/api/method/frappe.auth.get_logged_user", { body: { message: "api@servimar" } }));
  const health = await client.healthcheck();
  assert.equal(health.ok, true);
  assert.equal(health.provider, "erpnext");
  assert.equal(calls[0].headers.get("authorization"), "token the-key:the-secret");
  assert.equal(calls[0].url.href, "https://erp.example.com/api/method/frappe.auth.get_logged_user");
});

test("healthcheck como Guest es credencial inválida", async () => {
  const { client } = fakeErp(on("GET", "/api/method/frappe.auth.get_logged_user", { body: { message: "Guest" } }));
  await rejectsWith(client.healthcheck(), "unauthorized");
});

test("pullMasterData traduce Item, Batch y get_batch_qty al contrato", async () => {
  const { client, calls } = fakeErp(
    on("GET", "/api/resource/Item", { body: { data: ITEMS } }),
    on("GET", "/api/resource/Batch", { body: { data: BATCHES } }),
    on("GET", "/api/method/erpnext.stock.doctype.batch.batch.get_batch_qty", { body: { message: BATCH_QTY } }),
  );
  const data = await client.pullMasterData();

  assert.equal(data.contractVersion, ERP_CONTRACT_VERSION);
  assert.deepEqual(data.products[0], {
    externalId: "ACE-500", sku: "ACE-500", name: "Aceite de girasol 500 ml", uom: "Caja",
    batchTracked: true, active: true, updatedAt: "2026-10-01T12:00:00.000Z",
  });
  assert.deepEqual(data.lots[1], {
    externalId: "L-2026-0921", productExternalId: "ACE-500", lotNumber: "L-2026-0921",
    manufacturingDate: null, expirationDate: null, active: false, updatedAt: "2026-10-01T12:06:00.000Z",
  });
  // Solo lotes con stock, y solo de ítems con lote.
  assert.deepEqual(data.stock, [
    { productExternalId: "ACE-500", lotExternalId: "L-2026-0915", warehouseExternalId: "Depósito Central - SRV", quantity: 120, uom: "Caja" },
  ]);
  const stockCalls = calls.filter((call) => call.url.pathname.endsWith("get_batch_qty"));
  assert.deepEqual(stockCalls.map((call) => call.url.searchParams.get("item_code")), ["ACE-500"]);
});

test("updatedSince se envía como filtro de modified en hora del servidor", async () => {
  const { client, calls } = fakeErp(
    on("GET", "/api/resource/Item", { body: { data: [] } }),
    on("GET", "/api/resource/Batch", { body: { data: [] } }),
  );
  await client.pullMasterData({ updatedSince: "2026-10-05T03:00:00Z" });
  assert.deepEqual(filtersOf(calls[0]), [["is_stock_item", "=", 1], ["modified", ">=", "2026-10-05 00:00:00"]]);
});

test("los listados se paginan hasta recibir una página incompleta", async () => {
  const page = Array.from({ length: 500 }, (_, index) => ({ name: `SO-${index}` }));
  const { client, calls } = fakeErp(
    on("GET", "/api/resource/Sales Order", (call) => ({
      body: { data: call.url.searchParams.get("limit_start") === "0" ? page : [] },
    })),
    (call) => (call.url.pathname.startsWith("/api/resource/Sales%20Order/") ? { body: { data: { ...SALES_ORDER, name: "x" } } } : undefined),
  );
  const orders = await client.pullDispatchOrders();
  assert.equal(orders.length, 500);
  assert.deepEqual(
    calls.filter((call) => call.url.pathname === "/api/resource/Sales%20Order").map((call) => call.url.searchParams.get("limit_start")),
    ["0", "500"],
  );
});

test("pullDispatchOrders trae Sales Orders confirmadas pendientes de entrega", async () => {
  const { client, calls } = fakeErp(
    on("GET", "/api/resource/Sales Order", { body: { data: [{ name: "SAL-ORD-2026-00012" }] } }),
    salesOrder,
  );
  const [order] = await client.pullDispatchOrders();
  assert.deepEqual(filtersOf(calls[0]), [["docstatus", "=", 1], ["status", "in", ["To Deliver and Bill", "To Deliver"]]]);
  assert.deepEqual(order, {
    contractVersion: ERP_CONTRACT_VERSION,
    externalId: "SAL-ORD-2026-00012",
    status: "pending",
    customer: { externalId: "CUST-NORTE", name: "Distribuidora Norte" },
    scheduledDate: "2026-10-20",
    lines: [{ externalId: "so-item-1", productExternalId: "ACE-500", quantity: 65, uom: "Caja", warehouseExternalId: "Depósito Central - SRV" }],
    updatedAt: "2026-10-10T12:00:00.000Z",
  });
});

test("estado de Sales Order", () => {
  assert.equal(mapSalesOrderStatus({ status: "To Deliver", docstatus: 1, per_delivered: 0 }), "pending");
  assert.equal(mapSalesOrderStatus({ status: "To Deliver and Bill", docstatus: 1, per_delivered: 40 }), "partially_delivered");
  assert.equal(mapSalesOrderStatus({ status: "To Bill", docstatus: 1, per_delivered: 100 }), "delivered");
  assert.equal(mapSalesOrderStatus({ status: "Completed", docstatus: 1, per_delivered: 100 }), "delivered");
  assert.equal(mapSalesOrderStatus({ status: "Closed", docstatus: 1, per_delivered: 0 }), "cancelled");
  assert.equal(mapSalesOrderStatus({ status: "Cancelled", docstatus: 2, per_delivered: 0 }), "cancelled");
});

test("reportDispatch crea un remito en borrador con lote, pallet y clave de idempotencia", async () => {
  const { client, calls } = fakeErp(
    noDeliveryNote,
    salesOrder,
    on("POST", "/api/resource/Delivery Note", { body: { data: { name: "MAT-DN-2026-00001" } } }),
  );
  const result = await client.reportDispatch(REPORT);
  assert.deepEqual(result, { erpReference: "MAT-DN-2026-00001", duplicate: false, acceptedAt: NOW.toISOString() });

  assert.deepEqual(filtersOf(calls[0]), [["trazflow_idempotency_key", "=", "dispatch:SAL-ORD-2026-00012"], ["docstatus", "!=", 2]]);
  const post = calls.find((call) => call.method === "POST")!;
  assert.equal(post.headers.get("content-type"), "application/json");
  assert.deepEqual(post.body, {
    customer: "CUST-NORTE",
    posting_date: "2026-10-15",
    posting_time: "11:30:00",
    set_posting_time: 1,
    trazflow_idempotency_key: "dispatch:SAL-ORD-2026-00012",
    trazflow_operator: "Operador Depósito",
    items: [{
      item_code: "ACE-500", qty: 45, uom: "Caja", conversion_factor: 1,
      batch_no: "L-2026-0915", use_serial_batch_fields: 1, warehouse: "Depósito Central - SRV",
      against_sales_order: "SAL-ORD-2026-00012", so_detail: "so-item-1", trazflow_pallet_code: "PAL-0001",
    }],
  });
});

test("si ERPNext ya tiene un remito con la clave y el mismo contenido, no crea otro", async () => {
  const { client, calls } = fakeErp(existingDeliveryNote, deliveryNote());
  const result = await client.reportDispatch(REPORT);
  assert.deepEqual(result, { erpReference: "MAT-DN-2026-00001", duplicate: true, acceptedAt: "2026-10-15T14:31:00.000Z" });
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("la hora de Frappe sin cero a la izquierda sigue siendo el mismo reporte", async () => {
  const early = { ...REPORT, dispatchedAt: "2026-10-15T12:05:00.000Z" };
  const note = { ...DELIVERY_NOTE, posting_time: "9:05:00" };
  assert.equal((await fakeErp(existingDeliveryNote, deliveryNote(note)).client.reportDispatch(early)).duplicate, true);
});

test("la misma clave con otro contenido es un conflicto y no crea otro remito", async () => {
  // Segundo despacho parcial de la misma orden: otra cantidad y otro pallet con la misma clave.
  const partial = { ...REPORT, lines: [{ ...REPORT.lines[0], palletCode: "PAL-0002", quantity: 20 }] };
  const { client, calls } = fakeErp(existingDeliveryNote, deliveryNote());
  await rejectsWith(client.reportDispatch(partial), "conflict", 409);
  assert.equal(calls.some((call) => call.method === "POST"), false);

  const otherTime = { ...REPORT, dispatchedAt: "2026-10-15T14:45:00.000Z" };
  await rejectsWith(fakeErp(existingDeliveryNote, deliveryNote()).client.reportDispatch(otherTime), "conflict", 409);
});

for (const [status, excType] of [[409, "DuplicateEntryError"], [417, "UniqueValidationError"]] as const) {
  test(`un ${status} (${excType}) por envío simultáneo se resuelve como duplicado`, async () => {
    let lookups = 0;
    const { client } = fakeErp(
      on("GET", "/api/resource/Delivery Note", () => ({
        body: { data: lookups++ === 0 ? [] : [{ name: DELIVERY_NOTE.name, creation: DELIVERY_NOTE.creation }] },
      })),
      deliveryNote(),
      salesOrder,
      on("POST", "/api/resource/Delivery Note", { status, body: { exc_type: excType } }),
    );
    const result = await client.reportDispatch(REPORT);
    assert.equal(result.duplicate, true);
    assert.equal(result.erpReference, "MAT-DN-2026-00001");
  });
}

test("un 417 que no es por la clave se propaga como validación", async () => {
  const { client } = fakeErp(
    noDeliveryNote,
    salesOrder,
    on("POST", "/api/resource/Delivery Note", { status: 417, body: { exc_type: "ValidationError" } }),
  );
  await rejectsWith(client.reportDispatch(REPORT), "validation", 417);
});

test("orden inexistente o no confirmada es error de validación", async () => {
  await rejectsWith(fakeErp(noDeliveryNote).client.reportDispatch(REPORT), "validation", 422);
  const draft = on("GET", "/api/resource/Sales Order/SAL-ORD-2026-00012", { body: { data: { ...SALES_ORDER, docstatus: 0 } } });
  await rejectsWith(fakeErp(noDeliveryNote, draft).client.reportDispatch(REPORT), "validation", 422);
});

test("orden cerrada, completada o en espera no admite despachos", async () => {
  for (const status of ["Closed", "Completed", "On Hold", "To Bill"]) {
    const order = on("GET", "/api/resource/Sales Order/SAL-ORD-2026-00012", { body: { data: { ...SALES_ORDER, status } } });
    const { client, calls } = fakeErp(noDeliveryNote, order);
    await rejectsWith(client.reportDispatch(REPORT), "validation", 422);
    assert.equal(calls.some((call) => call.method === "POST"), false, status);
  }
});

test("producto que no está en la orden es error de validación", async () => {
  const report = { ...REPORT, lines: [{ ...REPORT.lines[0], orderLineExternalId: null, productExternalId: "ARR-1KG" }] };
  await rejectsWith(fakeErp(noDeliveryNote, salesOrder).client.reportDispatch(report), "validation", 422);
});

test("una línea informada que no es de la orden es error de validación", async () => {
  const report = { ...REPORT, lines: [{ ...REPORT.lines[0], orderLineExternalId: "linea-de-otra-orden" }] };
  const { client, calls } = fakeErp(noDeliveryNote, salesOrder);
  await rejectsWith(client.reportDispatch(report), "validation", 422);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("sin línea informada se usa la del mismo producto", async () => {
  const report = { ...REPORT, lines: [{ ...REPORT.lines[0], orderLineExternalId: null }] };
  const { client, calls } = fakeErp(
    noDeliveryNote,
    salesOrder,
    on("POST", "/api/resource/Delivery Note", { body: { data: { name: "MAT-DN-2026-00001" } } }),
  );
  await client.reportDispatch(report);
  const post = calls.find((call) => call.method === "POST")!;
  assert.equal((post.body as { items: { so_detail: string }[] }).items[0].so_detail, "so-item-1");
});

test("errores HTTP de ERPNext se traducen al contrato", async () => {
  const replying = (status: number) => fakeErp(on("GET", "/api/method/frappe.auth.get_logged_user", { status, body: {} })).client;
  await rejectsWith(replying(401).healthcheck(), "unauthorized", 401);
  await rejectsWith(replying(417).healthcheck(), "validation", 417);
  await rejectsWith(replying(422).healthcheck(), "validation", 422);
  await rejectsWith(replying(500).healthcheck(), "unavailable", 500);
});

test("timeout y caída de red son reintentables", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  await rejectsWith(fakeErp(() => timeout).client.healthcheck(), "timeout");
  await rejectsWith(fakeErp(() => new TypeError("fetch failed")).client.healthcheck(), "network");
});

test("respuesta que no es JSON es invalid_response", async () => {
  const htmlClient = new ErpNextClient({
    baseUrl: "https://erp.example.com", apiKey: "k", apiSecret: "s", timeoutMs: 1000,
    fetch: (async () => new Response("<html>login</html>", { status: 200 })) as typeof fetch,
  });
  await rejectsWith(htmlClient.healthcheck(), "invalid_response");
});

test("el mensaje de error no incluye trazas, HTML ni credenciales", async () => {
  const { client } = fakeErp(
    on("GET", "/api/method/frappe.auth.get_logged_user", {
      status: 417,
      body: {
        exc: "Traceback (most recent call last): secret stuff",
        exc_type: "ValidationError",
        _server_messages: JSON.stringify([JSON.stringify({ message: "Lote <b>L-1</b> vencido" })]),
      },
    }),
  );
  await assert.rejects(client.healthcheck(), (error: ErpError) => {
    assert.equal(error.message, "ERPNext respondió 417: Lote L-1 vencido");
    assert.doesNotMatch(error.message, /Traceback|the-key|the-secret/);
    return true;
  });
  assert.equal(frappeErrorMessage({ exc_type: "PermissionError" }), "PermissionError");
  assert.equal(frappeErrorMessage(null), "sin detalle");
  assert.equal(frappeErrorMessage({ message: "x".repeat(500) }).length, 300);
});

test("conversión de fechas de Frappe", () => {
  assert.equal(frappeDatetimeToIso("2026-10-10 09:00:00.123456"), "2026-10-10T12:00:00.123Z");
  assert.equal(frappeDatetimeToIso("2026-10-10"), "2026-10-10T03:00:00.000Z");
  assert.equal(isoToFrappeDatetime("2026-10-10T12:00:00.123Z"), "2026-10-10 09:00:00");
});
