import assert from "node:assert/strict";
import { test } from "node:test";

import { MockErpClient } from "../erp/mock-client.ts";
import type { DispatchReport } from "../erp/types.ts";
import { ErpOutboxClaimError, type ErpOutboxDb, type ErpOutboxLogger, type ProcessErpOutboxParams } from "../erp-outbox/processor.ts";
import { emptyErpOutboxRunSummary, type ErpOutboxRunSummary } from "../erp-outbox/types.ts";
import {
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_EVENTS,
  OUTBOX_REPORT_TIMEOUT_MS,
  OUTBOX_START_BUDGET_MS,
  runErpOutboxCron,
  type ErpOutboxCronParams,
} from "./erp-outbox-job.ts";

const SECRET = "s3creto-del-cron-de-prueba-1234567890";
const AUTH = `Bearer ${SECRET}`;

const silent: ErpOutboxLogger & { lines: string[] } = {
  lines: [],
  info(event, fields) { this.lines.push(`${event} ${JSON.stringify(fields)}`); },
  warn(event, fields) { this.lines.push(`${event} ${JSON.stringify(fields)}`); },
  error(event, fields) { this.lines.push(`${event} ${JSON.stringify(fields)}`); },
};

const noDb: ErpOutboxDb = {
  rpc() { throw new Error("no debería tocar la base"); },
};

function params(overrides: Partial<ErpOutboxCronParams> = {}): ErpOutboxCronParams {
  return {
    authorization: AUTH,
    secret: SECRET,
    erpEnabled: async () => true,
    createDb: () => noDb,
    getClient: () => new MockErpClient(),
    logger: silent,
    ...overrides,
  };
}

function batch(values: Partial<ErpOutboxRunSummary>): ErpOutboxRunSummary {
  return { ...emptyErpOutboxRunSummary(), ...values };
}

test("401 sin header, con secreto incorrecto o sin CRON_SECRET; no toca la base ni el ERP", async () => {
  let touched = false;
  const spy = { createDb: () => { touched = true; return noDb; }, erpEnabled: async () => { touched = true; return true; } };
  for (const overrides of [
    { authorization: null },
    { authorization: "Bearer incorrecto-pero-largo-1234567890" },
    { secret: undefined },
    { secret: "" },
  ]) {
    const result = await runErpOutboxCron(params({ ...spy, ...overrides }));
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { ok: false, error: "unauthorized" });
  }
  assert.equal(touched, false);
});

test("200 sin ERP: no crea el cliente service_role ni envía nada", async () => {
  let created = false;
  const result = await runErpOutboxCron(params({
    erpEnabled: async () => false,
    createDb: () => { created = true; return noDb; },
    process: async () => { throw new Error("no debería procesar"); },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok && result.body.erp, false);
  assert.equal(created, false);
});

test("500 si falta la clave service_role", async () => {
  const result = await runErpOutboxCron(params({ createDb: () => { throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY"); } }));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, error: "not_configured" });
  assert.ok(silent.lines.every((line) => !line.includes(SECRET)), "el secreto nunca va al log");
});

test("200 con resumen: procesa en tandas acotadas, con timeout por envío, hasta que no queda nada", async () => {
  const calls: ProcessErpOutboxParams[] = [];
  const results = [batch({ claimed: 5, sent: 5 }), batch({ claimed: 2, sent: 1, failed: 1 })];
  const result = await runErpOutboxCron(params({
    process: async (p) => { calls.push(p); return results.shift() ?? batch({}); },
  }));
  assert.equal(result.status, 200);
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(result.body.batches, 2);
  assert.equal(result.body.stoppedBy, "empty");
  assert.deepEqual(result.body.summary, { claimed: 7, sent: 6, duplicates: 0, retrying: 0, failed: 1, unrecorded: 0 });
  assert.deepEqual(calls.map((call) => call.limit), [OUTBOX_BATCH_SIZE, OUTBOX_BATCH_SIZE]);
  assert.ok(calls.every((call) => call.timeoutMs === OUTBOX_REPORT_TIMEOUT_MS));
  assert.ok(calls.every((call) => call.aggregateId === undefined && call.driverOrderId === undefined), "todas las empresas, sin filtro de orden");
  // El resumen no lleva payloads, claves ni referencias: solo contadores.
  assert.doesNotMatch(JSON.stringify(result.body), /payload|idempotency|dispatch:/);
});

test("una tanda dura menos que el lease (2 min) y el peor caso entra en maxDuration (300 s)", () => {
  assert.ok(OUTBOX_BATCH_SIZE * OUTBOX_REPORT_TIMEOUT_MS < 120_000);
  assert.ok(OUTBOX_START_BUDGET_MS + OUTBOX_BATCH_SIZE * OUTBOX_REPORT_TIMEOUT_MS < 300_000);
});

test("no pasa de OUTBOX_MAX_EVENTS por ejecución", async () => {
  const limits: number[] = [];
  const result = await runErpOutboxCron(params({
    process: async (p) => { limits.push(p.limit ?? 0); return batch({ claimed: p.limit, sent: p.limit }); },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(result.body.summary.claimed, OUTBOX_MAX_EVENTS);
  assert.equal(result.body.stoppedBy, "max_events");
  assert.equal(limits.reduce((a, b) => a + b, 0), OUTBOX_MAX_EVENTS);
});

test("corta por tiempo: no arranca otra tanda pasado el presupuesto", async () => {
  let clock = 0;
  let calls = 0;
  const result = await runErpOutboxCron(params({
    now: () => clock,
    process: async (p) => { calls += 1; clock += OUTBOX_START_BUDGET_MS; return batch({ claimed: p.limit, sent: p.limit }); },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(calls, 1);
  assert.equal(result.body.stoppedBy, "time");
});

test("si el ERP no responde, corta después de la tanda (los eventos quedan con su backoff)", async () => {
  let calls = 0;
  const result = await runErpOutboxCron(params({
    process: async (p) => { calls += 1; return batch({ claimed: p.limit, retrying: p.limit }); },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(calls, 1);
  assert.equal(result.body.stoppedBy, "erp_unavailable");
});

test("500 si no se pueden tomar eventos (permisos o base caída)", async () => {
  const result = await runErpOutboxCron(params({
    process: async () => { throw new ErpOutboxClaimError("sin permisos", "42501"); },
  }));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, error: "claim_failed" });
});

/* ---------- Con el procesador real: service_role toma eventos de varias empresas ---------- */

function report(order: string, productExternalId: string, lotExternalId: string): DispatchReport {
  return {
    contractVersion: 1,
    idempotencyKey: `dispatch:${order}`,
    orderExternalId: order,
    dispatchedAt: "2026-10-28T12:00:00.000Z",
    operator: { id: "5d0c0000-0000-0000-0000-000000000001", name: "Operador" },
    lines: [{ orderLineExternalId: null, palletCode: `PAL-${order}`, productExternalId, lotExternalId, quantity: 10, uom: "Caja" }],
  };
}

test("con el procesador real envía los reportes vencidos de dos empresas en la misma corrida", async () => {
  // Imita erp_outbox_claim con service_role: sin filtro de empresa.
  const events = [
    { id: "a1", company: "A", idempotency_key: "dispatch:SAL-ORD-2026-00012", payload: report("SAL-ORD-2026-00012", "ACE-500", "L-2026-0915"), status: "pending", attempts: 0 },
    { id: "b1", company: "B", idempotency_key: "dispatch:SAL-ORD-2026-00014", payload: report("SAL-ORD-2026-00014", "ARR-1KG", "ARR-2026-08"), status: "pending", attempts: 1 },
  ];
  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      if (fn === "erp_outbox_claim") {
        const claimed = events.filter((event) => event.status === "pending").slice(0, Number(args.p_limit));
        for (const event of claimed) { event.status = "processing"; event.attempts += 1; }
        return { data: claimed.map(({ id, idempotency_key, payload, attempts }) => ({ id, idempotency_key, payload, attempts })), error: null };
      }
      const event = events.find((item) => item.id === args.p_event_id);
      if (!event || event.attempts !== args.p_attempt) return { data: false, error: null };
      if (fn === "erp_outbox_mark_sent") { event.status = "sent"; return { data: true, error: null }; }
      if (fn === "erp_outbox_mark_failed") { event.status = "pending"; return { data: "pending", error: null }; }
      return { data: null, error: { message: "rpc desconocida" } };
    },
  };
  const result = await runErpOutboxCron(params({ createDb: () => db, getClient: () => new MockErpClient() }));
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(result.body.summary.sent, 2, JSON.stringify(result.body));
  assert.deepEqual(events.map((event) => [event.company, event.status]), [["A", "sent"], ["B", "sent"]]);
});
