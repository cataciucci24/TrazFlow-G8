import assert from "node:assert/strict";
import { test } from "vitest";

import { MockErpClient } from "../erp/mock-client.ts";
import type { ErpOutboxLogger } from "../erp-outbox/processor.ts";
import { ErpSyncStartError, type ErpSyncDb, type SyncCompanyParams } from "../erp-sync/sync.ts";
import type { ErpSyncRunSummary } from "../erp-sync/types.ts";
import { runErpSyncCron, SYNC_START_BUDGET_MS, type ErpSyncCronParams } from "./erp-sync-job.ts";

const SECRET = "s3creto-del-cron-de-prueba-1234567890";

const logger: ErpOutboxLogger = { info() {}, warn() {}, error() {} };

function companiesDb(ids: string[], error: { message: string; code?: string } | null = null): ErpSyncDb & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async rpc(fn) {
      calls.push(fn);
      if (fn === "erp_sync_auto_companies") {
        return error ? { data: null, error } : { data: ids.map((company_id) => ({ company_id, last_started_at: null })), error: null };
      }
      return { data: null, error: { message: `rpc inesperada ${fn}` } };
    },
  };
}

function run(id: string, status: ErpSyncRunSummary["status"] = "success"): ErpSyncRunSummary {
  return { id, status, provider: "mock", startedAt: "2026-10-28T12:00:00Z", finishedAt: "2026-10-28T12:00:05Z", counters: {}, errors: [], notices: [], errorMessage: null };
}

function params(overrides: Partial<ErpSyncCronParams> = {}): ErpSyncCronParams {
  return {
    authorization: `Bearer ${SECRET}`,
    secret: SECRET,
    createDb: () => companiesDb([]),
    getContext: async () => ({ provider: "mock", client: new MockErpClient() }),
    logger,
    ...overrides,
  };
}

test("401 sin secreto, con secreto incorrecto o sin CRON_SECRET; no sincroniza nada", async () => {
  let synced = false;
  for (const overrides of [{ authorization: null }, { authorization: "Bearer otro-secreto-largo-12345678" }, { secret: undefined }]) {
    const result = await runErpSyncCron(params({ ...overrides, sync: async () => { synced = true; return run("x"); } }));
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { ok: false, error: "unauthorized" });
  }
  assert.equal(synced, false);
});

test("TRZ-112: las empresas sin ERP se saltean sin sincronizar", async () => {
  const synced: string[] = [];
  const result = await runErpSyncCron(params({
    createDb: () => companiesDb(["sin-erp", "con-erp"]),
    getContext: async (companyId) => companyId === "con-erp" ? { provider: "mock", client: new MockErpClient() } : null,
    sync: async (p) => { synced.push(p.companyId); return run(`run-${p.companyId}`); },
  }));
  assert.equal(result.status, 200);
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(synced, ["con-erp"]);
  assert.deepEqual(result.body.companies.map((c) => [c.companyId, c.result]), [["sin-erp", "skipped_no_erp"], ["con-erp", "success"]]);
});

test("TRZ-112: una configuración inválida marca error en esa empresa y sigue con las demás", async () => {
  const result = await runErpSyncCron(params({
    createDb: () => companiesDb(["rota", "ok"]),
    getContext: async (companyId) => {
      if (companyId === "rota") throw new Error("Faltan las credenciales");
      return { provider: "mock", client: new MockErpClient() };
    },
    sync: async (p) => run(`run-${p.companyId}`),
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(result.body.companies.map((c) => c.result), ["error", "success"]);
});

test("sincroniza varias empresas sin usuario, con service_role, en el orden que da la base", async () => {
  const calls: SyncCompanyParams[] = [];
  const db = companiesDb(["company-b", "company-a"]);
  const clients: string[] = [];
  const result = await runErpSyncCron(params({
    createDb: () => db,
    getContext: async (companyId) => {
      clients.push(companyId);
      return { provider: companyId === "company-a" ? "odoo" : "erpnext", client: new MockErpClient() };
    },
    sync: async (p) => { calls.push(p); p.getClient(); return run(`run-${p.companyId}`, p.companyId === "company-a" ? "partial" : "success"); },
  }));
  assert.equal(result.status, 200);
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(result.body.companies, [
    { companyId: "company-b", result: "success", runId: "run-company-b" },
    { companyId: "company-a", result: "partial", runId: "run-company-a" },
  ]);
  assert.deepEqual(calls.map((call) => [call.companyId, call.actorId, call.provider]), [
    ["company-b", null, "erpnext"],
    ["company-a", null, "odoo"],
  ]);
  assert.ok(calls.every((call) => call.db === db), "todas con el cliente service_role");
  assert.deepEqual(clients, ["company-b", "company-a"], "TRZ-112: el ERP (y el proveedor auditado) se piden por empresa");
});

test("una empresa con una sincronización en curso se saltea sin error y sigue con las demás", async () => {
  const result = await runErpSyncCron(params({
    createDb: () => companiesDb(["busy", "free"]),
    sync: async (p) => {
      if (p.companyId === "busy") throw new ErpSyncStartError("Ya hay una sincronización en curso", "55P03");
      return run("run-free");
    },
  }));
  assert.equal(result.status, 200);
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(result.body.companies.map((c) => [c.companyId, c.result]), [["busy", "skipped_running"], ["free", "success"]]);
});

test("una falla de una empresa no corta las demás", async () => {
  const result = await runErpSyncCron(params({
    createDb: () => companiesDb(["broken", "ok"]),
    sync: async (p) => {
      if (p.companyId === "broken") throw new Error("No se pudo cerrar la auditoría");
      return run("run-ok");
    },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(result.body.companies.map((c) => c.result), ["error", "success"]);
});

test("corta por tiempo: pasado el presupuesto no arranca otra empresa (va primero la próxima vez)", async () => {
  let clock = 0;
  const synced: string[] = [];
  const result = await runErpSyncCron(params({
    now: () => clock,
    createDb: () => companiesDb(["first", "second", "third"]),
    sync: async (p) => { synced.push(p.companyId); clock += SYNC_START_BUDGET_MS; return run(`run-${p.companyId}`); },
  }));
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(synced, ["first"]);
  assert.deepEqual(result.body.companies.map((c) => c.result), ["success", "skipped_time", "skipped_time"]);
});

test("500 si no se pueden listar las empresas o falta la clave service_role", async () => {
  const listed = await runErpSyncCron(params({ createDb: () => companiesDb([], { message: "denied", code: "42501" }) }));
  assert.equal(listed.status, 500);
  assert.deepEqual(listed.body, { ok: false, error: "companies_failed" });

  const missing = await runErpSyncCron(params({ createDb: () => { throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY"); } }));
  assert.equal(missing.status, 500);
  assert.deepEqual(missing.body, { ok: false, error: "not_configured" });
});

test("sin empresas con ERP responde 200 con la lista vacía", async () => {
  const result = await runErpSyncCron(params({ createDb: () => companiesDb([]) }));
  assert.equal(result.status, 200);
  assert.ok(result.body.ok && result.body.erp);
  assert.deepEqual(result.body.companies, []);
});
