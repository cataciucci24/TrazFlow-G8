import assert from "node:assert/strict";
import { test } from "node:test";

import type { ErpClient } from "../erp/client.ts";
import { MOCK_ERP_FIXTURES } from "../erp/fixtures.ts";
import { MockErpClient } from "../erp/mock-client.ts";
import { ErpError } from "../erp/types.ts";
import { ErpSyncStartError, syncCompanyFromErp, type ErpSyncDb } from "./sync.ts";

type Call = { fn: string; args: Record<string, unknown> };

type DueEvent = { id: string; idempotency_key: string };

/**
 * Base falsa: registra las RPC y cierra el run como lo haría erp_sync_finish (partial si se auditaron errores).
 * `due` = reportes cuyo remito hay que consultar (erp_outbox_dispatch_documents_due).
 */
function fakeDb(options: { failOn?: string; startError?: string; due?: DueEvent[] } = {}) {
  const calls: Call[] = [];
  const applied: string[] = [];
  let savedErrors: unknown[] = [];
  const db: ErpSyncDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === options.failOn) return { data: null, error: { message: "db down", code: "08006" } };
      if (fn === "erp_outbox_dispatch_documents_due") return { data: options.due ?? [], error: null };
      if (fn === "erp_outbox_record_dispatch_document") return { data: true, error: null };
      if (fn === "erp_sync_save_dispatch_documents") {
        savedErrors = args.p_errors as unknown[];
        return { data: null, error: null };
      }
      if (fn === "erp_sync_start") {
        return options.startError
          ? { data: null, error: { message: "boom", code: options.startError } }
          : { data: "run-1", error: null };
      }
      if (fn === "erp_sync_finish") {
        const fatal = args.p_error as string | null;
        return {
          data: {
            id: "run-1",
            status: fatal ? (applied.length ? "partial" : "failed") : savedErrors.length ? "partial" : "success",
            provider: "mock",
            started_at: "2026-10-19T12:00:00Z",
            finished_at: "2026-10-19T12:00:01Z",
            counters: Object.fromEntries(applied.map((entity) => [entity, { received: 1 }])),
            errors: savedErrors,
            error_message: fatal,
          },
          error: null,
        };
      }
      applied.push(fn.replace("erp_sync_apply_", ""));
      return { data: {}, error: null };
    },
  };
  return { db, calls };
}

const base = { companyId: "company-1", actorId: "user-1", provider: "mock" };

test("consulta remitos y aplica productos, lotes, stock y órdenes en orden, con las unidades traducidas", async () => {
  const { db, calls } = fakeDb();
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient() });

  assert.equal(run.status, "success");
  assert.deepEqual(calls.map((call) => call.fn), [
    "erp_sync_start",
    "erp_outbox_dispatch_documents_due",
    "erp_sync_save_dispatch_documents",
    "erp_sync_apply_products",
    "erp_sync_apply_lots",
    "erp_sync_apply_stock",
    "erp_sync_apply_orders",
    "erp_sync_finish",
  ]);
  assert.deepEqual(calls[0].args, { p_company_id: "company-1", p_actor_id: "user-1", p_provider: "mock" });

  assert.deepEqual(calls[1].args, { p_company_id: "company-1", p_limit: 20 });
  const products = calls[3].args.p_records as { externalId: string; unit: string }[];
  assert.equal(products.length, MOCK_ERP_FIXTURES.products.length);
  assert.deepEqual(products.find((product) => product.externalId === "QSO-HORMA")?.unit, "kilogramos");

  const stock = calls[5].args.p_records as { unit: string; quantity: number }[];
  assert.ok(stock.every((balance) => balance.unit));
  assert.ok(stock.some((balance) => balance.quantity === 356.5));

  // El mock solo devuelve órdenes abiertas; se mandan con sus líneas (TRZ-100) y la unidad traducida.
  const orders = calls[6].args.p_records as { externalId: string; lines: Record<string, unknown>[] }[];
  assert.equal(orders.length, 4);
  assert.deepEqual(Object.keys(orders[0]).sort(), ["customer", "externalId", "lines", "scheduledDate", "status"]);
  assert.deepEqual(orders.find((order) => order.externalId === "SAL-ORD-2026-00013")?.lines, [{
    externalId: "SAL-ORD-2026-00013-1",
    productExternalId: "QSO-HORMA",
    quantity: 48.25,
    uom: "Kg",
    unit: "kilogramos",
    warehouseExternalId: "Depósito Central - SRV",
  }]);
  assert.equal(calls[7].args.p_error, null);
});

test("consulta los remitos ANTES de traer el stock, para liberar los pallets en la misma corrida", async () => {
  const { db, calls } = fakeDb({ due: [{ id: "event-1", idempotency_key: "dispatch:SAL-ORD-2026-00012" }] });
  const order: string[] = [];
  const client = new MockErpClient();
  const getDispatchStatus = client.getDispatchStatus.bind(client);
  const pullMasterData = client.pullMasterData.bind(client);
  client.getDispatchStatus = async (key) => { order.push("getDispatchStatus"); return getDispatchStatus(key); };
  client.pullMasterData = async (options) => { order.push("pullMasterData"); return pullMasterData(options); };

  const run = await syncCompanyFromErp({ ...base, db, getClient: () => client });

  assert.equal(run.status, "success");
  assert.deepEqual(order, ["getDispatchStatus", "pullMasterData"]);
  const recorded = calls.find((call) => call.fn === "erp_outbox_record_dispatch_document");
  assert.deepEqual(recorded?.args, { p_event_id: "event-1", p_status: "confirmed", p_erp_reference: null });
  const saved = calls.find((call) => call.fn === "erp_sync_save_dispatch_documents");
  assert.deepEqual(saved?.args.p_counters, { received: 1, draft: 0, confirmed: 1, cancelled: 0, not_found: 0, failed: 0 });
  assert.ok(calls.findIndex((call) => call.fn === "erp_sync_save_dispatch_documents")
    < calls.findIndex((call) => call.fn === "erp_sync_apply_stock"));
});

test("si falla la consulta de remitos, la sincronización sigue y queda parcial", async () => {
  const { db, calls } = fakeDb({ due: [{ id: "event-1", idempotency_key: "dispatch:SAL-ORD-2026-00012" }] });
  const client = new MockErpClient();
  client.getDispatchStatus = async () => { throw new ErpError("unavailable", "Error interno del ERP (mock).", { status: 500 }); };

  const run = await syncCompanyFromErp({ ...base, db, getClient: () => client });

  assert.equal(run.status, "partial");
  assert.equal(run.errorMessage, null);
  assert.deepEqual(run.errors, [{
    external_id: "dispatch:SAL-ORD-2026-00012",
    message: "Al consultar el remito en el ERP: Error interno del ERP (mock).",
  }]);
  assert.ok(calls.some((call) => call.fn === "erp_sync_apply_orders"), "sigue con productos, lotes, stock y órdenes");
});

test("si no se puede guardar la consulta de remitos, la corrida se corta sin traer maestros", async () => {
  const { db, calls } = fakeDb({ failOn: "erp_sync_save_dispatch_documents" });
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient() });
  assert.equal(run.status, "failed");
  assert.equal(run.errorMessage, "No se pudo guardar la consulta de remitos en TrazFlow.");
  assert.ok(!calls.some((call) => call.fn === "erp_sync_apply_products"));
});

test("nunca manda un QR ni datos del proveedor en los registros", async () => {
  const { db, calls } = fakeDb();
  await syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient() });
  const payload = JSON.stringify(calls.map((call) => call.args));
  assert.doesNotMatch(payload, /qr_?code/i);
});

test("si el ERP no responde, cierra el run como fallido con el mensaje sanitizado", async () => {
  const { db, calls } = fakeDb();
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient({ scenario: "timeout" }) });

  assert.equal(run.status, "failed");
  assert.match(run.errorMessage ?? "", /^Al leer productos, lotes y stock del ERP: El ERP no respondió a tiempo/);
  // Sin reportes para consultar, no se le pregunta nada al ERP antes de los maestros.
  assert.deepEqual(calls.map((call) => call.fn), [
    "erp_sync_start", "erp_outbox_dispatch_documents_due", "erp_sync_save_dispatch_documents", "erp_sync_finish",
  ]);
});

test("si fallan las órdenes después de aplicar maestros, el run queda parcial", async () => {
  const { db, calls } = fakeDb();
  const run = await syncCompanyFromErp({
    ...base,
    db,
    getClient: () => new MockErpClient({ failures: ["ok", "unauthorized"] }),
  });

  assert.equal(run.status, "partial");
  assert.match(run.errorMessage ?? "", /órdenes de despacho/);
  assert.ok(!calls.some((call) => call.fn === "erp_sync_apply_orders"));
});

test("una configuración inválida queda auditada como falla", async () => {
  const { db } = fakeDb();
  const run = await syncCompanyFromErp({
    ...base,
    db,
    getClient: () => { throw new ErpError("config", "ERP_PROVIDER inválido: \"x\"."); },
  });
  assert.equal(run.status, "failed");
  assert.equal(run.errorMessage, "ERP_PROVIDER inválido: \"x\".");
});

test("un error inesperado no filtra detalles a la auditoría", async () => {
  const { db } = fakeDb();
  const leaky: ErpClient = {
    ...new MockErpClient(),
    provider: "mock",
    healthcheck: async () => { throw new Error("secret=abc"); },
    pullMasterData: async () => { throw new TypeError("Authorization: token abc:def"); },
    pullDispatchOrders: async () => [],
    reportDispatch: async () => { throw new Error("no"); },
    getDispatchStatus: async () => { throw new Error("no"); },
  };
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => leaky });
  assert.equal(run.errorMessage, "Error inesperado durante la sincronización.");
});

test("una versión de contrato desconocida corta la sincronización", async () => {
  const { db } = fakeDb();
  const client = new MockErpClient();
  const original = client.pullMasterData.bind(client);
  client.pullMasterData = async () => ({ ...(await original()), contractVersion: 2 as never });
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => client });
  assert.equal(run.status, "failed");
  assert.match(run.errorMessage ?? "", /versión de contrato 2/);
});

test("si la base falla al aplicar, se audita sin exponer el error crudo", async () => {
  const { db } = fakeDb({ failOn: "erp_sync_apply_lots" });
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient() });
  assert.equal(run.status, "partial");
  assert.equal(run.errorMessage, "No se pudieron guardar los lotes en TrazFlow.");
});

test("si no se puede abrir el run, no llama al ERP", async () => {
  const { db, calls } = fakeDb({ startError: "42501" });
  let asked = false;
  await assert.rejects(
    syncCompanyFromErp({ ...base, db, getClient: () => { asked = true; return new MockErpClient(); } }),
    (error) => error instanceof ErpSyncStartError && /Solo logística/.test(error.message),
  );
  assert.equal(asked, false);
  assert.equal(calls.length, 1);
});

test("otra sincronización en curso devuelve un mensaje claro", async () => {
  const { db } = fakeDb({ startError: "55P03" });
  await assert.rejects(
    syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient() }),
    /en curso/,
  );
});
