import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ERPNEXT_REVIEW_TAG,
  ErpNextClient,
  buildDeliveryComment,
  deliveryCommentMarker,
  deliveryReceiptFileName,
} from "./erpnext-client.ts";
import { ERP_CONTRACT_VERSION, ErpError, type DeliveryReceipt, type DeliveryReport } from "./types.ts";

/* TRZ-103: entrega y remito firmado en el Delivery Note del despacho. */

const NOW = new Date("2026-10-28T15:00:00.000Z");
const NOTE = { name: "MAT-DN-2026-00001", creation: "2026-10-28 11:00:00.000000" };

const REPORT: DeliveryReport = {
  contractVersion: ERP_CONTRACT_VERSION,
  idempotencyKey: "delivery:SAL-ORD-2026-00012",
  orderExternalId: "SAL-ORD-2026-00012",
  dispatchIdempotencyKey: "dispatch:SAL-ORD-2026-00012",
  deliveredAt: "2026-10-28T15:00:00.000Z",
  driver: { id: "d1", name: "Chofer <Uno>" },
  needsReview: true,
  lines: [{ palletCode: "PAL-1", outcome: "delivered" }, { palletCode: "PAL-2", outcome: "damaged" }],
  discrepancies: [{ palletCode: "PAL-2", type: "damaged" }, { palletCode: "PAL-X", type: "wrong_order" }],
};

const RECEIPT: DeliveryReceipt = {
  contractVersion: ERP_CONTRACT_VERSION,
  idempotencyKey: "delivery-receipt:SAL-ORD-2026-00012:3f2a",
  orderExternalId: "SAL-ORD-2026-00012",
  dispatchIdempotencyKey: "dispatch:SAL-ORD-2026-00012",
  fileName: "IMG_0001.jpg",
  contentType: "image/jpeg",
  sizeBytes: 3,
  uploadedAt: "2026-10-28T15:01:00.000Z",
};

type Call = { method: string; path: string; url: URL; json: unknown; form: FormData | null };

function fakeErp(handler: (call: Call) => { status?: number; body?: unknown } | undefined) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const form = init.body instanceof FormData ? init.body : null;
    const call: Call = {
      method: init.method ?? "GET",
      path: decodeURIComponent(url.pathname),
      url,
      json: init.body && !form ? JSON.parse(String(init.body)) : undefined,
      form,
    };
    if (form) assert.equal(new Headers(init.headers).has("Content-Type"), false, "multipart: fetch pone el boundary");
    calls.push(call);
    const reply = handler(call);
    if (reply) return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    return new Response(JSON.stringify({ exc_type: "DoesNotExistError" }), { status: 404 });
  }) as typeof fetch;
  const client = new ErpNextClient({
    baseUrl: "https://erp.example.com", apiKey: "k", apiSecret: "s", timeoutMs: 1000, fetch: fetchImpl, now: () => NOW,
  });
  return { client, calls };
}

function listing(call: Call, doctype: string, rows: unknown[]) {
  if (call.method === "GET" && call.path === `/api/resource/${doctype}`) return { body: { data: rows } };
  return undefined;
}

const filtersOf = (call: Call) => JSON.parse(call.url.searchParams.get("filters") ?? "[]");

test("reportDelivery: etiqueta para revisión y comentario con el resultado por pallet, sin confirmar el remito", async () => {
  const { client, calls } = fakeErp((call) =>
    listing(call, "Delivery Note", [NOTE])
    ?? listing(call, "Comment", [])
    ?? (call.method === "POST" ? { body: { data: { name: "x" }, message: "ok" } } : undefined));

  const result = await client.reportDelivery(REPORT);

  assert.deepEqual(result, { erpReference: NOTE.name, duplicate: false, acceptedAt: NOW.toISOString() });
  const dnLookup = calls.find((call) => call.path === "/api/resource/Delivery Note")!;
  assert.deepEqual(filtersOf(dnLookup)[0], ["trazflow_idempotency_key", "=", "dispatch:SAL-ORD-2026-00012"]);
  const posts = calls.filter((call) => call.method === "POST");
  assert.deepEqual(posts.map((call) => call.path), ["/api/method/frappe.desk.doctype.tag.tag.add_tag", "/api/resource/Comment"]);
  assert.deepEqual(posts[0].json, { tag: ERPNEXT_REVIEW_TAG, dt: "Delivery Note", dn: NOTE.name });
  const comment = posts[1].json as Record<string, string>;
  assert.equal(comment.reference_doctype, "Delivery Note");
  assert.equal(comment.reference_name, NOTE.name);
  assert.ok(comment.content.includes(deliveryCommentMarker(REPORT.idempotencyKey)));
  assert.ok(!calls.some((call) => call.path.includes("submit") || (call.method !== "GET" && call.path.startsWith("/api/resource/Delivery Note"))),
    "nunca toca ni confirma el Delivery Note");
});

test("reportDelivery sin diferencias no etiqueta", async () => {
  const { client, calls } = fakeErp((call) =>
    listing(call, "Delivery Note", [NOTE]) ?? listing(call, "Comment", []) ?? (call.method === "POST" ? { body: {} } : undefined));
  await client.reportDelivery({ ...REPORT, needsReview: false, lines: [{ palletCode: "PAL-1", outcome: "delivered" }], discrepancies: [] });
  assert.deepEqual(calls.filter((call) => call.method === "POST").map((call) => call.path), ["/api/resource/Comment"]);
});

test("reportDelivery: si el comentario ya existe es un duplicado y no escribe nada", async () => {
  const { client, calls } = fakeErp((call) =>
    listing(call, "Delivery Note", [NOTE]) ?? listing(call, "Comment", [{ name: "c1", creation: "2026-10-28 12:00:00.000000" }]));
  const result = await client.reportDelivery(REPORT);
  assert.equal(result.duplicate, true);
  assert.equal(result.erpReference, NOTE.name);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  const commentLookup = calls.find((call) => call.path === "/api/resource/Comment")!;
  assert.deepEqual(filtersOf(commentLookup)[2], ["content", "like", "%[trazflow:delivery:SAL-ORD-2026-00012]%"]);
});

test("sin Delivery Note del despacho: not_ready, reintentable", async () => {
  const { client } = fakeErp((call) => listing(call, "Delivery Note", []));
  for (const promise of [client.reportDelivery(REPORT), client.attachDeliveryReceipt(RECEIPT, new Uint8Array([1, 2, 3]))]) {
    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof ErpError);
      assert.equal(error.code, "not_ready");
      assert.equal(error.retryable, true);
      return true;
    });
  }
});

test("attachDeliveryReceipt sube el archivo privado al Delivery Note con un nombre fijo por clave", async () => {
  const { client, calls } = fakeErp((call) =>
    listing(call, "Delivery Note", [NOTE])
    ?? listing(call, "File", [])
    ?? (call.method === "POST" && call.path === "/api/method/upload_file" ? { body: { message: { name: "file-1" } } } : undefined));

  const result = await client.attachDeliveryReceipt(RECEIPT, new Uint8Array([1, 2, 3]));

  assert.equal(result.erpReference, NOTE.name);
  assert.equal(result.duplicate, false);
  const upload = calls.find((call) => call.path === "/api/method/upload_file")!;
  assert.equal(upload.form!.get("doctype"), "Delivery Note");
  assert.equal(upload.form!.get("docname"), NOTE.name);
  assert.equal(upload.form!.get("is_private"), "1");
  const file = upload.form!.get("file") as File;
  assert.equal(file.name, "trazflow-delivery-receipt-SAL-ORD-2026-00012-3f2a.jpg");
  assert.equal(file.size, 3);
  const fileLookup = calls.find((call) => call.path === "/api/resource/File")!;
  assert.deepEqual(filtersOf(fileLookup)[2], ["file_name", "=", file.name]);
});

test("attachDeliveryReceipt: si el archivo ya está adjunto no lo vuelve a subir", async () => {
  const { client, calls } = fakeErp((call) =>
    listing(call, "Delivery Note", [NOTE]) ?? listing(call, "File", [{ name: "file-1", creation: "2026-10-28 12:00:00.000000" }]));
  const result = await client.attachDeliveryReceipt(RECEIPT, new Uint8Array([1, 2, 3]));
  assert.equal(result.duplicate, true);
  assert.ok(!calls.some((call) => call.path === "/api/method/upload_file"));
});

test("attachDeliveryReceipt valida tipo y tamaño antes de llamar al ERP", async () => {
  const { client, calls } = fakeErp(() => undefined);
  await assert.rejects(client.attachDeliveryReceipt({ ...RECEIPT, contentType: "text/plain" }, new Uint8Array([1])), { code: "validation" });
  await assert.rejects(client.attachDeliveryReceipt(RECEIPT, new Uint8Array()), { code: "validation" });
  assert.equal(calls.length, 0);
});

test("el comentario escapa HTML y lista pallets y diferencias", () => {
  const html = buildDeliveryComment(REPORT);
  assert.ok(html.includes("Chofer &lt;Uno&gt;"));
  assert.ok(html.includes("PAL-2: Dañado"));
  assert.ok(html.includes("PAL-X: No corresponde a la orden"));
  assert.ok(html.includes("revisar antes de confirmar"));
  assert.equal(deliveryReceiptFileName({ idempotencyKey: "delivery-receipt:SO 1/x:ab", contentType: "application/pdf" }), "trazflow-delivery-receipt-SO-1-x-ab.pdf");
});
