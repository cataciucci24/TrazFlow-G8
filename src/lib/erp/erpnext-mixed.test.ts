import assert from "node:assert/strict";
import { test } from "vitest";

import { buildDeliveryComment, ERPNEXT_CUSTOM_FIELDS, ErpNextClient, type ErpNextSalesOrder } from "./erpnext-client.ts";
import { ErpError, type DeliveryReport, type PalletItem, type PalletScanReport } from "./types.ts";

/** TRZ-111 (contrato v2): Pick List con pallets mixtos y content_mismatch en la entrega, con ERPNext falso. */

const KEY = ERPNEXT_CUSTOM_FIELDS.idempotencyKey;
const SCAN_KEY = "pallet-scan:SO-0042:P-0007:1";
const ITEMS: PalletItem[] = [
  { productExternalId: "ITEM-AGUA", lotExternalId: "L-AG-11", quantity: 40, uom: "Unit" },
  { productExternalId: "ITEM-JUGO", lotExternalId: "L-JU-03", quantity: 20, uom: "Unit" },
];
const ORDER: ErpNextSalesOrder = {
  name: "SO-0042", company: "Demo", customer: "CUST-NORTE", customer_name: "Distribuidora Norte", delivery_date: "2026-11-24",
  status: "To Deliver and Bill", docstatus: 1, per_delivered: 0, modified: "2026-11-20 10:00:00.000000",
  items: [
    { name: "SOI-1", item_code: "ITEM-AGUA", stock_qty: 100, stock_uom: "Unit", warehouse: "Central - D" },
    { name: "SOI-2", item_code: "ITEM-JUGO", stock_qty: 20, stock_uom: "Unit", warehouse: "Central - D" },
  ],
};

const scanV2: PalletScanReport = {
  contractVersion: 2, idempotencyKey: SCAN_KEY, scanIdempotencyKey: SCAN_KEY, action: "scan",
  orderExternalId: "SO-0042", palletCode: "P-0007", items: ITEMS, at: "2026-11-24T12:40:00.000Z",
};
const unscanV2: PalletScanReport = { ...scanV2, idempotencyKey: "pallet-unscan:SO-0042:P-0007:1", action: "unscan", at: "2026-11-24T12:52:00.000Z" };

type Row = Record<string, unknown>;

/** ERPNext con un Pick List en memoria: guarda las filas y cuenta las escrituras. */
function fakeErpNext(initialRows?: Row[]) {
  let pickList: { name: string; docstatus: number; locations: Row[]; [key: string]: unknown } | null = initialRows
    ? { name: "PICK-0001", docstatus: 0, creation: "2026-11-24 09:00:00", [KEY]: "pick-list:SO-0042", locations: initialRows }
    : null;
  const comments: string[] = [];
  const writes: { method: string; path: string; body: Row }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Row) : {};
    if (method !== "GET") writes.push({ method, path, body });

    if (path === "/api/resource/Sales Order/SO-0042") return json({ data: ORDER });
    if (path === "/api/resource/Pick List" && method === "GET") return json({ data: pickList ? [{ name: pickList.name, creation: pickList.creation }] : [] });
    if (path === "/api/resource/Pick List" && method === "POST") {
      pickList = { ...body, name: "PICK-0001", docstatus: 0, creation: "2026-11-24 09:00:00", locations: body.locations as Row[] };
      return json({ data: { name: pickList.name } });
    }
    if (path === "/api/resource/Pick List/PICK-0001" && pickList) {
      if (method === "PUT") pickList.locations = body.locations as Row[];
      return json({ data: pickList });
    }
    if (path === "/api/resource/Comment" && method === "GET") {
      const filters = JSON.parse(url.searchParams.get("filters") ?? "[]") as [string, string, string][];
      const like = filters.find(([field]) => field === "content")?.[2].replaceAll("%", "") ?? "";
      return json({ data: comments.filter((content) => content.includes(like)).map((_, index) => ({ name: `C-${index}` })) });
    }
    if (path === "/api/resource/Comment" && method === "POST") {
      comments.push(String(body.content));
      return json({ data: { name: `C-${comments.length}` } });
    }
    return json({ exc_type: "DoesNotExistError" }, 404);
  }) as typeof fetch;

  const client = new ErpNextClient({ baseUrl: "https://erp.example.com", apiKey: "k", apiSecret: "s", timeoutMs: 1000, fetch: fetchImpl });
  return { client, writes, comments, rows: () => pickList?.locations ?? [] };
}

const otherPallet: Row = { item_code: "ITEM-AGUA", batch_no: "L-AG-12", qty: 60, [ERPNEXT_CUSTOM_FIELDS.palletCode]: "P-0008", [KEY]: "pallet-scan:SO-0042:P-0008:1" };

test("scan mixto: todas las filas del pallet en una sola escritura, cada una con la clave del scan", async () => {
  const { client, writes, rows } = fakeErpNext([otherPallet]);
  const result = await client.reportPalletScan(scanV2);

  assert.equal(result.duplicate, false);
  assert.deepEqual(writes.map((write) => `${write.method} ${write.path}`), ["PUT /api/resource/Pick List/PICK-0001"]);
  const added = rows().filter((row) => row[KEY] === SCAN_KEY);
  assert.deepEqual(added.map((row) => [row.item_code, row.batch_no, row.qty, row.sales_order_item]), [
    ["ITEM-AGUA", "L-AG-11", 40, "SOI-1"],
    ["ITEM-JUGO", "L-JU-03", 20, "SOI-2"],
  ]);
  assert.equal(rows().length, 3, "el otro pallet queda");
});

test("scan mixto sin Pick List: se crea con todas las filas en un solo POST; el reintento es duplicate sin escribir", async () => {
  const { client, writes, rows } = fakeErpNext();
  await client.reportPalletScan(scanV2);
  assert.deepEqual(writes.map((write) => write.method), ["POST"]);
  assert.equal(rows().length, 2);

  const retry = await client.reportPalletScan(scanV2);
  assert.equal(retry.duplicate, true);
  assert.equal(writes.length, 1, "el reintento no escribe");
});

test("unscan mixto: comentario con todos los ítems y después un solo PUT que saca todas las filas del scan", async () => {
  const { client, writes, comments, rows } = fakeErpNext([otherPallet]);
  await client.reportPalletScan(scanV2);
  writes.length = 0;

  const result = await client.reportPalletScan(unscanV2);
  assert.equal(result.duplicate, false);
  assert.deepEqual(writes.map((write) => `${write.method} ${write.path}`), ["POST /api/resource/Comment", "PUT /api/resource/Pick List/PICK-0001"]);
  assert.match(comments[0], /\[trazflow:pallet-unscan:SO-0042:P-0007:1\]/);
  assert.match(comments[0], /ITEM-AGUA lote L-AG-11, 40 Unit.*ITEM-JUGO lote L-JU-03, 20 Unit/);
  assert.deepEqual(rows(), [otherPallet]);

  const retry = await client.reportPalletScan(unscanV2);
  assert.equal(retry.duplicate, true);
  assert.equal(writes.length, 2, "el reintento no escribe");
});

test("unscan antes de su scan es not_ready (reintentable)", async () => {
  const { client } = fakeErpNext([otherPallet]);
  await assert.rejects(client.reportPalletScan(unscanV2), (error: unknown) => error instanceof ErpError && error.code === "not_ready" && error.retryable);
});

test("evento v1 sin cambios: una fila con la clave del scan, como antes", async () => {
  const { client, rows } = fakeErpNext([]);
  const v1: PalletScanReport = {
    contractVersion: 1, idempotencyKey: "pallet-scan:SO-0042:P-0008:1", scanIdempotencyKey: "pallet-scan:SO-0042:P-0008:1", action: "scan",
    orderExternalId: "SO-0042", palletCode: "P-0008", productExternalId: "ITEM-AGUA", lotExternalId: "L-AG-12", quantity: 60, uom: "Unit",
    at: "2026-11-24T12:41:00.000Z",
  };
  await client.reportPalletScan(v1);
  assert.deepEqual(rows().map((row) => [row.item_code, row.batch_no, row.qty, row[ERPNEXT_CUSTOM_FIELDS.palletCode], row[KEY]]), [
    ["ITEM-AGUA", "L-AG-12", 60, "P-0008", "pallet-scan:SO-0042:P-0008:1"],
  ]);
  assert.equal((await client.reportPalletScan(v1)).duplicate, true);
});

test("replay de un scan después del unscan no vuelve a cargar el pallet", async () => {
  const { client, rows, writes } = fakeErpNext([]);
  await client.reportPalletScan(scanV2);
  await client.reportPalletScan(unscanV2);
  const before = writes.length;
  assert.equal((await client.reportPalletScan(scanV2)).duplicate, true);
  assert.deepEqual(rows(), []);
  assert.equal(writes.length, before);
});

test("content_mismatch en el comentario: lo esperado, lo detectado y lo desconocido como texto", () => {
  const report: DeliveryReport = {
    contractVersion: 2, idempotencyKey: "delivery:SO-0042", orderExternalId: "SO-0042", dispatchIdempotencyKey: "dispatch:SO-0042",
    deliveredAt: "2026-11-24T16:20:00.000Z", driver: { id: "u-31", name: "Chofer Demo" }, needsReview: true,
    lines: [{ palletCode: "P-0007", outcome: "delivered" }],
    discrepancies: [{ palletCode: "P-0007", type: "content_mismatch", contentDifferences: [
      { expected: ITEMS[1], detected: { ...ITEMS[1], observedSku: null, observedLot: null, quantity: 15 } },
      { expected: null, detected: { productExternalId: null, lotExternalId: null, observedSku: "GASEOSA-<X>", observedLot: "SIN-LOTE", quantity: 3, uom: "Unit" } },
      { expected: null, detected: { productExternalId: null, lotExternalId: null, observedSku: "SIN-DATOS", observedLot: null, quantity: null, uom: null } },
    ] }],
  };
  const comment = buildDeliveryComment(report);
  assert.match(comment, /P-0007: Contenido distinto al esperado/);
  assert.match(comment, /Esperado: ITEM-JUGO lote L-JU-03, 20 Unit · Detectado: ITEM-JUGO lote L-JU-03, 15 Unit/);
  assert.match(comment, /Esperado: nada \(sobrante\) · Detectado: sin identificar en el ERP: &quot;GASEOSA-&lt;X&gt;&quot; lote &quot;SIN-LOTE&quot; \(sin identificar\), 3 Unit/);
  assert.match(comment, /SIN-DATOS.*cantidad desconocida unidad desconocida/);
});
