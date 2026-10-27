import assert from "node:assert/strict";
import { test } from "node:test";

import { MockErpClient } from "../erp/mock-client.ts";
import { ErpError, type DeliveryReceipt, type DeliveryReport } from "../erp/types.ts";
import { DELIVERY_RECEIPTS_BUCKET, processErpOutbox, type ErpOutboxDb, type ErpOutboxLogger } from "./processor.ts";

/* TRZ-103: el procesador elige la operación del contrato por el prefijo de la clave. */

const quiet: ErpOutboxLogger = { info: () => {}, warn: () => {}, error: () => {} };

type Row = { id: string; idempotency_key: string; payload: unknown; attempts: number; status: string; last_error_code?: string };

function fakeDb(rows: Array<{ id: string; payload: { idempotencyKey: string } }>, files: Record<string, Uint8Array> = {}, withStorage = true) {
  const events = new Map<string, Row>(rows.map((row) => [row.id, {
    id: row.id, idempotency_key: row.payload.idempotencyKey, payload: row.payload, attempts: 0, status: "pending",
  }]));
  const downloads: string[] = [];
  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      if (fn === "erp_outbox_claim") {
        const claimed = [...events.values()].filter((row) => row.status === "pending");
        for (const row of claimed) { row.status = "processing"; row.attempts += 1; }
        return { data: claimed.map(({ id, idempotency_key, payload, attempts }) => ({ id, idempotency_key, payload, attempts })), error: null };
      }
      const row = events.get(String(args.p_event_id))!;
      if (fn === "erp_outbox_mark_sent") { row.status = "sent"; return { data: true, error: null }; }
      if (fn === "erp_outbox_mark_failed") {
        row.status = args.p_retryable ? "pending" : "failed";
        row.last_error_code = String(args.p_error_code);
        return { data: row.status, error: null };
      }
      throw new Error(`RPC inesperada ${fn}`);
    },
    ...(withStorage ? {
      storage: {
        from(bucket: string) {
          assert.equal(bucket, DELIVERY_RECEIPTS_BUCKET);
          return {
            async download(path: string) {
              downloads.push(path);
              const file = files[path];
              return file ? { data: new Blob([file as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: "not found" } };
            },
          };
        },
      },
    } : {}),
  };
  return { db, events, downloads };
}

function delivery(overrides: Partial<DeliveryReport> = {}): DeliveryReport {
  return {
    contractVersion: 1,
    idempotencyKey: "delivery:SAL-ORD-2026-00012",
    orderExternalId: "SAL-ORD-2026-00012",
    dispatchIdempotencyKey: "dispatch:SAL-ORD-2026-00012",
    deliveredAt: "2026-10-28T15:00:00.000Z",
    driver: { id: "d1", name: "Chofer" },
    needsReview: true,
    lines: [{ palletCode: "PAL-1", outcome: "delivered" }, { palletCode: "PAL-2", outcome: "damaged" }],
    discrepancies: [{ palletCode: "PAL-2", type: "damaged" }],
    ...overrides,
  };
}

const PATH = "company/order/remito.jpg";

function receiptPayload(overrides: Partial<DeliveryReceipt & { storagePath: string }> = {}) {
  return {
    contractVersion: 1 as const,
    idempotencyKey: "delivery-receipt:SAL-ORD-2026-00012:r1",
    orderExternalId: "SAL-ORD-2026-00012",
    dispatchIdempotencyKey: "dispatch:SAL-ORD-2026-00012",
    fileName: "remito.jpg",
    contentType: "image/jpeg",
    sizeBytes: 3,
    uploadedAt: "2026-10-28T15:01:00.000Z",
    storagePath: PATH,
    receiptId: "r1",
    ...overrides,
  };
}

test("delivery: llama a reportDelivery con el payload guardado", async () => {
  const fake = fakeDb([{ id: "ev-d", payload: delivery() }]);
  const erp = new MockErpClient();
  const received: DeliveryReport[] = [];
  const client = Object.assign(erp, {
    reportDelivery: (report: DeliveryReport) => { received.push(report); return MockErpClient.prototype.reportDelivery.call(erp, report); },
  });
  const summary = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.equal(summary.sent, 1);
  assert.deepEqual(received, [delivery()]);
  assert.equal(fake.events.get("ev-d")!.status, "sent");
});

test("delivery-receipt: descarga el archivo del bucket y lo adjunta", async () => {
  const fake = fakeDb([{ id: "ev-r", payload: receiptPayload() }], { [PATH]: new Uint8Array([1, 2, 3]) });
  const erp = new MockErpClient();
  let got: { receipt: DeliveryReceipt; size: number } | null = null;
  const client = Object.assign(erp, {
    attachDeliveryReceipt: (receipt: DeliveryReceipt, content: Uint8Array) => {
      got = { receipt, size: content.byteLength };
      return MockErpClient.prototype.attachDeliveryReceipt.call(erp, receipt, content);
    },
  });
  const summary = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.equal(summary.sent, 1);
  assert.deepEqual(fake.downloads, [PATH]);
  assert.equal(got!.size, 3);
  assert.equal(got!.receipt.fileName, "remito.jpg");
  assert.equal("storagePath" in got!.receipt, false, "la ruta interna no viaja al ERP");
});

test("delivery-receipt: si no se puede leer el archivo, se reintenta", async () => {
  const fake = fakeDb([{ id: "ev-r", payload: receiptPayload() }]);
  const summary = await processErpOutbox({ db: fake.db, getClient: () => new MockErpClient(), logger: quiet });
  assert.equal(summary.retrying, 1);
  assert.equal(fake.events.get("ev-r")!.last_error_code, "unavailable");
});

test("delivery-receipt: sin acceso a Storage queda pendiente, no fallido", async () => {
  const fake = fakeDb([{ id: "ev-r", payload: receiptPayload() }], {}, false);
  const summary = await processErpOutbox({ db: fake.db, getClient: () => new MockErpClient(), logger: quiet });
  assert.equal(summary.retrying, 1);
  assert.equal(fake.events.get("ev-r")!.last_error_code, "not_ready");
});

test("not_ready del ERP (todavía no hay remito del despacho) es reintentable", async () => {
  const fake = fakeDb([{ id: "ev-d", payload: delivery() }]);
  const erp = Object.assign(new MockErpClient(), {
    reportDelivery: async () => { throw new ErpError("not_ready", "Todavía no hay remito."); },
  });
  const summary = await processErpOutbox({ db: fake.db, getClient: () => erp, logger: quiet });
  assert.equal(summary.retrying, 1);
  assert.equal(fake.events.get("ev-d")!.status, "pending");
});

test("payloads de entrega inválidos fallan sin llamar al ERP", async () => {
  const fake = fakeDb([
    { id: "ev-1", payload: delivery({ needsReview: false }) },
    { id: "ev-2", payload: delivery({ idempotencyKey: "delivery:OTRA", lines: [] }) },
    { id: "ev-3", payload: receiptPayload({ contentType: "text/plain" }) },
    { id: "ev-4", payload: receiptPayload({ storagePath: "" }) },
  ]);
  let calls = 0;
  const erp = Object.assign(new MockErpClient(), {
    reportDelivery: async () => { calls += 1; throw new Error("no"); },
    attachDeliveryReceipt: async () => { calls += 1; throw new Error("no"); },
  });
  const summary = await processErpOutbox({ db: fake.db, getClient: () => erp, logger: quiet });
  assert.equal(summary.failed, 4);
  assert.equal(calls, 0);
  for (const id of ["ev-1", "ev-2", "ev-3", "ev-4"]) assert.equal(fake.events.get(id)!.last_error_code, "validation");
});

test("mock: reportDelivery y attachDeliveryReceipt son idempotentes por clave", async () => {
  const erp = new MockErpClient();
  const first = await erp.reportDelivery(delivery());
  const again = await erp.reportDelivery(delivery());
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.erpReference, first.erpReference);
  await assert.rejects(erp.reportDelivery(delivery({ lines: [{ palletCode: "PAL-1", outcome: "missing" }] })), { code: "conflict" });

  const payload: Partial<ReturnType<typeof receiptPayload>> = receiptPayload();
  delete payload.storagePath;
  delete payload.receiptId;
  const receipt = payload as DeliveryReceipt;
  const attached = await erp.attachDeliveryReceipt(receipt, new Uint8Array([1]));
  assert.equal(attached.duplicate, false);
  assert.equal((await erp.attachDeliveryReceipt(receipt, new Uint8Array([1]))).duplicate, true);
  await assert.rejects(erp.attachDeliveryReceipt(receipt, new Uint8Array()), { code: "validation" });
});

test("mock: el escenario validation también rechaza la entrega", async () => {
  await assert.rejects(new MockErpClient({ scenario: "validation" }).reportDelivery(delivery()), { code: "validation" });
});

test("como chofer usa las RPC erp_outbox_driver_* con la orden", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let claimed = false;
  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      calls.push([fn, args]);
      if (fn === "erp_outbox_driver_claim") {
        const rows = claimed ? [] : [{ id: "ev-d", idempotency_key: delivery().idempotencyKey, payload: delivery(), attempts: 1 }];
        claimed = true;
        return { data: rows, error: null };
      }
      if (fn === "erp_outbox_driver_mark_sent") return { data: true, error: null };
      throw new Error(`RPC inesperada ${fn}`);
    },
  };
  const summary = await processErpOutbox({ db, getClient: () => new MockErpClient(), logger: quiet, driverOrderId: "order-1" });
  assert.equal(summary.sent, 1);
  assert.deepEqual(calls.map(([fn]) => fn), ["erp_outbox_driver_claim", "erp_outbox_driver_mark_sent"]);
  assert.deepEqual(calls[0][1], { p_order_id: "order-1" });
});
