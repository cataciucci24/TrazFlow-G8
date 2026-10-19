import assert from "node:assert/strict";
import { test } from "node:test";

import type { ErpClient } from "../erp/client.ts";
import { MockErpClient } from "../erp/mock-client.ts";
import { ERP_CONTRACT_VERSION, type DispatchReport } from "../erp/types.ts";
import type { ErpOutboxLogger } from "../erp-outbox/processor.ts";
import { describeProcessing, describeRetry, processDueErpEvents, retryFailedErpEvent } from "./outbox.ts";

const SILENT: ErpOutboxLogger = { info() {}, warn() {}, error() {} };
const MAX_ATTEMPTS = 10;
const EVENT_ID = "e1";
const ORDER_ID = "o1";

function report(): DispatchReport {
  return {
    contractVersion: ERP_CONTRACT_VERSION,
    idempotencyKey: "dispatch:SAL-ORD-2026-00012",
    orderExternalId: "SAL-ORD-2026-00012",
    dispatchedAt: "2026-10-19T12:00:00.000Z",
    operator: { id: "op-1", name: "Operador" },
    lines: [{ orderLineExternalId: null, palletCode: "PAL-1", productExternalId: "ACE-500", lotExternalId: "L-2026-0915", quantity: 45, uom: "Caja" }],
  };
}

type Event = { id: string; aggregate_id: string; idempotency_key: string; payload: unknown; status: string; attempts: number };

/** Imita erp_outbox_retry_failed / claim / mark_sent / mark_failed (20261019140000 y 20261019150000). */
function fakeDb(event: Partial<Event> = {}, errors: Record<string, string> = {}) {
  const state: Event = {
    id: EVENT_ID, aggregate_id: ORDER_ID, idempotency_key: "dispatch:SAL-ORD-2026-00012",
    payload: report(), status: "failed", attempts: 3, ...event,
  };
  const original = JSON.stringify(state.payload);
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (errors[fn]) return { data: null, error: { message: "x", code: errors[fn] } };
      switch (fn) {
        case "erp_outbox_retry_failed":
          if (state.status !== "failed") return { data: null, error: { message: "x", code: "55000" } };
          state.status = "pending";
          return { data: state.aggregate_id, error: null };
        case "erp_outbox_claim": {
          const due = state.status === "pending" && (!args.p_aggregate_id || args.p_aggregate_id === state.aggregate_id);
          if (!due) return { data: [], error: null };
          state.status = "processing";
          state.attempts += 1;
          return { data: [{ id: state.id, idempotency_key: state.idempotency_key, payload: structuredClone(state.payload), attempts: state.attempts }], error: null };
        }
        case "erp_outbox_mark_sent":
          state.status = "sent";
          return { data: true, error: null };
        case "erp_outbox_mark_failed":
          state.status = args.p_retryable && state.attempts < MAX_ATTEMPTS ? "pending" : "failed";
          return { data: state.status, error: null };
      }
      return { data: null, error: { message: "unknown rpc", code: "42883" } };
    },
  };
  return { db, state, calls, original };
}

test("reintento: vuelve a pendiente y se envía en el momento, con el mismo payload y solo ese evento", async () => {
  const fake = fakeDb();
  const sent: DispatchReport[] = [];
  const client = new MockErpClient();
  const original = client.reportDispatch.bind(client);
  client.reportDispatch = async (r) => { sent.push(r); return original(r); };

  const result = await retryFailedErpEvent({ db: fake.db, eventId: EVENT_ID, getClient: () => client, logger: SILENT });

  assert.equal(result.outcome, "requeued");
  assert.equal(result.outcome === "requeued" && result.summary?.sent, 1);
  assert.deepEqual(fake.calls.map((call) => call.fn), ["erp_outbox_retry_failed", "erp_outbox_claim", "erp_outbox_mark_sent"]);
  assert.deepEqual(fake.calls[1].args, { p_limit: 1, p_aggregate_id: ORDER_ID });
  assert.equal(JSON.stringify(sent[0]), fake.original, "el payload enviado es el original");
  assert.equal(JSON.stringify(fake.state.payload), fake.original, "el payload guardado no cambia");
  assert.equal(fake.state.status, "sent");
  assert.equal(describeRetry(result).status, "success");
});

test("con los intentos agotados, si el envío extra falla vuelve a failed (no queda en processing)", async () => {
  const fake = fakeDb({ attempts: MAX_ATTEMPTS });
  const result = await retryFailedErpEvent({
    db: fake.db, eventId: EVENT_ID, getClient: () => new MockErpClient({ scenario: "timeout" }), logger: SILENT,
  });
  assert.equal(fake.state.status, "failed");
  assert.equal(fake.state.attempts, MAX_ATTEMPTS + 1);
  const markFailed = fake.calls.find((call) => call.fn === "erp_outbox_mark_failed");
  assert.equal(markFailed?.args.p_retryable, true, "el timeout es reintentable, pero no quedan intentos");
  const message = describeRetry(result);
  assert.equal(message.status, "error");
  assert.match(message.message ?? "", /volvieron a fallar/);
});

test("con intentos disponibles, un timeout deja el reporte pendiente con reintento automático", async () => {
  const fake = fakeDb({ attempts: 2 });
  const hanging = { provider: "mock", reportDispatch: () => new Promise(() => {}) } as unknown as ErpClient;
  const result = await retryFailedErpEvent({ db: fake.db, eventId: EVENT_ID, getClient: () => hanging, timeoutMs: 20, logger: SILENT });
  assert.equal(fake.state.status, "pending");
  assert.equal(describeRetry(result).status, "warning");
});

test("sin ERP configurado solo se reencola: no se llama al ERP ni se toma el evento", async () => {
  const fake = fakeDb();
  const result = await retryFailedErpEvent({ db: fake.db, eventId: EVENT_ID, getClient: null, logger: SILENT });
  assert.deepEqual(fake.calls.map((call) => call.fn), ["erp_outbox_retry_failed"]);
  assert.equal(fake.state.status, "pending");
  assert.match(describeRetry(result).message ?? "", /quedó pendiente/);
});

test("errores de la RPC de reintento", async () => {
  for (const [code, outcome] of [["42501", "forbidden"], ["P0002", "not_found"], ["55000", "not_failed"], ["08006", "error"]] as const) {
    const fake = fakeDb({}, { erp_outbox_retry_failed: code });
    const result = await retryFailedErpEvent({ db: fake.db, eventId: EVENT_ID, getClient: () => new MockErpClient(), logger: SILENT });
    assert.equal(result.outcome, outcome, code);
    assert.equal(fake.calls.length, 1, "si el reintento falla no se procesa nada");
  }
  assert.equal(describeRetry({ outcome: "forbidden" }).status, "error");
  assert.equal(describeRetry({ outcome: "not_failed" }).status, "warning");
});

test("un evento que no está fallido no se reintenta", async () => {
  const fake = fakeDb({ status: "pending" });
  const result = await retryFailedErpEvent({ db: fake.db, eventId: EVENT_ID, getClient: () => new MockErpClient(), logger: SILENT });
  assert.equal(result.outcome, "not_failed");
});

test("si no se puede procesar después del reintento, el reporte queda pendiente", async () => {
  const fake = fakeDb({}, { erp_outbox_claim: "08006" });
  const result = await retryFailedErpEvent({ db: fake.db, eventId: EVENT_ID, getClient: () => new MockErpClient(), logger: SILENT });
  assert.deepEqual(result, { outcome: "requeued", summary: null });
  assert.equal(fake.state.status, "pending");
});

test("enviar pendientes: procesa los vencidos con límite y timeout acotados", async () => {
  const fake = fakeDb({ status: "pending" });
  const result = await processDueErpEvents({ db: fake.db, getClient: () => new MockErpClient(), logger: SILENT });
  assert.ok(!("error" in result));
  assert.equal(!("error" in result) && result.sent, 1);
  assert.deepEqual(fake.calls[0].args, { p_limit: 5, p_aggregate_id: null });
});

test("enviar pendientes: sin permisos devuelve un mensaje claro", async () => {
  const fake = fakeDb({ status: "pending" }, { erp_outbox_claim: "42501" });
  assert.deepEqual(await processDueErpEvents({ db: fake.db, getClient: () => new MockErpClient(), logger: SILENT }),
    { error: "No tenés permisos para procesar reportes al ERP." });
});

test("mensajes del procesamiento", () => {
  const base = { claimed: 0, sent: 0, duplicates: 0, retrying: 0, failed: 0, unrecorded: 0 };
  assert.deepEqual(describeProcessing(null, "nada"), { status: "warning", message: "nada" });
  assert.deepEqual(describeProcessing(base, "nada"), { status: "warning", message: "nada" });
  assert.deepEqual(describeProcessing({ ...base, claimed: 2, sent: 2, duplicates: 1 }, "nada"),
    { status: "success", message: "2 enviado(s) al ERP · 1 ya estaban registrados en el ERP." });
  assert.equal(describeProcessing({ ...base, claimed: 1, retrying: 1 }, "nada").status, "warning");
  assert.equal(describeProcessing({ ...base, claimed: 1, unrecorded: 1 }, "nada").status, "error");
});
