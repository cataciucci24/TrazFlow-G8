import assert from "node:assert/strict";
import { test } from "vitest";

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

/** Base que solo contesta erp_outbox_due_companies (el procesador va inyectado). */
function dueDb(companies: string[] = ["A"]): ErpOutboxDb {
  return {
    async rpc(fn) {
      if (fn === "erp_outbox_due_companies") return { data: companies.map((company_id) => ({ company_id, due_count: 1 })), error: null };
      throw new Error(`no debería llamar ${fn}`);
    },
  };
}

function params(overrides: Partial<ErpOutboxCronParams> = {}): ErpOutboxCronParams {
  return {
    authorization: AUTH,
    secret: SECRET,
    createDb: () => dueDb(),
    erpEnabled: async () => true,
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
  const spy = { createDb: () => { touched = true; return dueDb(); }, erpEnabled: async () => { touched = true; return true; } };
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

test("200 sin ERP en las empresas con pendientes: no procesa ni envía nada", async () => {
  const result = await runErpOutboxCron(params({
    erpEnabled: async () => false,
    process: async () => { throw new Error("no debería procesar"); },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok && result.body.erp, false);
});

test("200 sin empresas con pendientes: no procesa", async () => {
  const result = await runErpOutboxCron(params({
    createDb: () => dueDb([]),
    process: async () => { throw new Error("no debería procesar"); },
  }));
  assert.equal(result.status, 200);
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(result.body.companies, 0);
  assert.equal(result.body.batches, 0);
});

test("500 si falta la clave service_role", async () => {
  const result = await runErpOutboxCron(params({ createDb: () => { throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY"); } }));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, error: "not_configured" });
  assert.ok(silent.lines.every((line) => !line.includes(SECRET)), "el secreto nunca va al log");
});

test("500 si no se pueden listar las empresas con pendientes", async () => {
  const db: ErpOutboxDb = { async rpc() { return { data: null, error: { message: "x", code: "42501" } }; } };
  const result = await runErpOutboxCron(params({ createDb: () => db }));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, error: "claim_failed" });
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
  assert.equal(result.body.companies, 1);
  assert.equal(result.body.stoppedBy, "empty");
  assert.deepEqual(result.body.summary, { claimed: 7, sent: 6, duplicates: 0, retrying: 0, failed: 1, unrecorded: 0 });
  assert.deepEqual(calls.map((call) => call.limit), [OUTBOX_BATCH_SIZE, OUTBOX_BATCH_SIZE]);
  assert.ok(calls.every((call) => call.timeoutMs === OUTBOX_REPORT_TIMEOUT_MS));
  assert.ok(calls.every((call) => call.companyId === "A"), "TRZ-112: siempre con la empresa");
  assert.ok(calls.every((call) => call.aggregateId === undefined && call.driverOrderId === undefined), "sin filtro de orden");
  // El resumen no lleva payloads, claves ni referencias: solo contadores.
  assert.doesNotMatch(JSON.stringify(result.body), /payload|idempotency|dispatch:/);
});

test("TRZ-112: procesa empresa por empresa y saltea las que no tienen ERP", async () => {
  const processed: string[] = [];
  const result = await runErpOutboxCron(params({
    createDb: () => dueDb(["A", "SIN-ERP", "B"]),
    erpEnabled: async (companyId) => companyId !== "SIN-ERP",
    process: async (p) => { processed.push(p.companyId!); return batch({ claimed: 1, sent: 1 }); },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(processed, ["A", "B"]);
  assert.equal(result.body.companies, 2);
});

test("TRZ-112: un ERP caído no frena a las demás empresas", async () => {
  const processed: string[] = [];
  const result = await runErpOutboxCron(params({
    createDb: () => dueDb(["A", "B"]),
    process: async (p) => {
      processed.push(p.companyId!);
      return p.companyId === "A" ? batch({ claimed: p.limit, retrying: p.limit }) : batch({ claimed: 1, sent: 1 });
    },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(processed, ["A", "B"], "A se corta después de su tanda y sigue B");
  assert.equal(result.body.unavailable, 1);
  assert.equal(result.body.summary.sent, 1);
});

test("TRZ-112: si falla el claim de una empresa sigue con las otras; si fallan todas, 500", async () => {
  const ok = await runErpOutboxCron(params({
    createDb: () => dueDb(["A", "B"]),
    process: async (p) => {
      if (p.companyId === "A") throw new ErpOutboxClaimError("sin permisos", "42501");
      return batch({ claimed: 1, sent: 1 });
    },
  }));
  assert.equal(ok.status, 200);
  assert.ok(ok.body.ok && ok.body.erp && ok.body.summary.sent === 1);

  const failing = await runErpOutboxCron(params({
    process: async () => { throw new ErpOutboxClaimError("sin permisos", "42501"); },
  }));
  assert.equal(failing.status, 500);
  assert.deepEqual(failing.body, { ok: false, error: "claim_failed" });
});

test("TRZ-112: si no se puede leer el ERP de una empresa, se saltea sin cortar", async () => {
  const processed: string[] = [];
  const result = await runErpOutboxCron(params({
    createDb: () => dueDb(["A", "B"]),
    erpEnabled: async (companyId) => { if (companyId === "A") throw new Error("base caída"); return true; },
    process: async (p) => { processed.push(p.companyId!); return batch({ claimed: 0 }); },
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(processed, ["B"]);
});

test("una tanda dura menos que el lease (2 min) y el peor caso entra en maxDuration (300 s)", () => {
  assert.ok(OUTBOX_BATCH_SIZE * OUTBOX_REPORT_TIMEOUT_MS < 120_000);
  assert.ok(OUTBOX_START_BUDGET_MS + OUTBOX_BATCH_SIZE * OUTBOX_REPORT_TIMEOUT_MS < 300_000);
});

test("no pasa de OUTBOX_MAX_EVENTS por ejecución, sumando todas las empresas", async () => {
  const limits: number[] = [];
  const result = await runErpOutboxCron(params({
    createDb: () => dueDb(["A", "B"]),
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
    createDb: () => dueDb(["A", "B"]),
    now: () => clock,
    process: async (p) => { calls += 1; clock += OUTBOX_START_BUDGET_MS; return batch({ claimed: p.limit, sent: p.limit }); },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(calls, 1);
  assert.equal(result.body.stoppedBy, "time");
});

/* ---------- Con el procesador real: service_role, empresa por empresa ---------- */

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

test("con el procesador real: la misma orden externa en dos empresas sale por el ERP de cada una", async () => {
  // Imita erp_outbox_due_companies y erp_outbox_claim(p_company_id) con service_role.
  const events = [
    { id: "a1", company_id: "A", idempotency_key: "dispatch:SAL-ORD-2026-00012", payload: report("SAL-ORD-2026-00012", "ACE-500", "L-2026-0915"), status: "pending", attempts: 0 },
    { id: "b1", company_id: "B", idempotency_key: "dispatch:SAL-ORD-2026-00012", payload: report("SAL-ORD-2026-00012", "ARR-1KG", "ARR-2026-08"), status: "pending", attempts: 1 },
  ];
  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      if (fn === "erp_outbox_due_companies") {
        return { data: [...new Set(events.filter((e) => e.status === "pending").map((e) => e.company_id))].map((company_id) => ({ company_id })), error: null };
      }
      if (fn === "erp_outbox_claim") {
        const claimed = events
          .filter((event) => event.status === "pending" && event.company_id === args.p_company_id)
          .slice(0, Number(args.p_limit));
        for (const event of claimed) { event.status = "processing"; event.attempts += 1; }
        return { data: claimed.map(({ id, company_id, idempotency_key, payload, attempts }) => ({ id, company_id, idempotency_key, payload, attempts })), error: null };
      }
      const event = events.find((item) => item.id === args.p_event_id);
      if (!event || event.attempts !== args.p_attempt) return { data: false, error: null };
      if (fn === "erp_outbox_mark_sent") { event.status = "sent"; return { data: true, error: null }; }
      if (fn === "erp_outbox_mark_failed") { event.status = "pending"; return { data: "pending", error: null }; }
      return { data: null, error: { message: "rpc desconocida" } };
    },
  };
  const erps = { A: new MockErpClient(), B: new MockErpClient() };
  const result = await runErpOutboxCron(params({ createDb: () => db, getClient: (companyId) => erps[companyId as "A" | "B"] }));
  assert.ok(result.body.ok && result.body.erp);
  assert.equal(result.body.summary.sent, 2, JSON.stringify(result.body));
  assert.equal(result.body.summary.duplicates, 0, "cada ERP recibe la orden una sola vez: no se cruzan");
  assert.deepEqual(events.map((event) => [event.company_id, event.status]), [["A", "sent"], ["B", "sent"]]);
});
