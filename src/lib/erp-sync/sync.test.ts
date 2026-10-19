import assert from "node:assert/strict";
import { test } from "node:test";

import type { ErpClient } from "../erp/client.ts";
import { MOCK_ERP_FIXTURES } from "../erp/fixtures.ts";
import { MockErpClient } from "../erp/mock-client.ts";
import { ErpError } from "../erp/types.ts";
import { ErpSyncStartError, syncCompanyFromErp, type ErpSyncDb } from "./sync.ts";

type Call = { fn: string; args: Record<string, unknown> };

/** Base falsa: registra las RPC y cierra el run como lo haría erp_sync_finish. */
function fakeDb(options: { failOn?: string; startError?: string } = {}) {
  const calls: Call[] = [];
  const applied: string[] = [];
  const db: ErpSyncDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === "erp_sync_start") {
        return options.startError
          ? { data: null, error: { message: "boom", code: options.startError } }
          : { data: "run-1", error: null };
      }
      if (fn === options.failOn) return { data: null, error: { message: "db down", code: "08006" } };
      if (fn === "erp_sync_finish") {
        const fatal = args.p_error as string | null;
        return {
          data: {
            id: "run-1",
            status: fatal ? (applied.length ? "partial" : "failed") : "success",
            provider: "mock",
            started_at: "2026-10-19T12:00:00Z",
            finished_at: "2026-10-19T12:00:01Z",
            counters: Object.fromEntries(applied.map((entity) => [entity, { received: 1 }])),
            errors: [],
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

test("aplica productos, lotes, stock y órdenes en orden, con las unidades traducidas", async () => {
  const { db, calls } = fakeDb();
  const run = await syncCompanyFromErp({ ...base, db, getClient: () => new MockErpClient() });

  assert.equal(run.status, "success");
  assert.deepEqual(calls.map((call) => call.fn), [
    "erp_sync_start",
    "erp_sync_apply_products",
    "erp_sync_apply_lots",
    "erp_sync_apply_stock",
    "erp_sync_apply_orders",
    "erp_sync_finish",
  ]);
  assert.deepEqual(calls[0].args, { p_company_id: "company-1", p_actor_id: "user-1", p_provider: "mock" });

  const products = calls[1].args.p_records as { externalId: string; unit: string }[];
  assert.equal(products.length, MOCK_ERP_FIXTURES.products.length);
  assert.deepEqual(products.find((product) => product.externalId === "QSO-HORMA")?.unit, "kilogramos");

  const stock = calls[3].args.p_records as { unit: string; quantity: number }[];
  assert.ok(stock.every((balance) => balance.unit));
  assert.ok(stock.some((balance) => balance.quantity === 356.5));

  // El mock solo devuelve órdenes abiertas; se manda solo la cabecera.
  const orders = calls[4].args.p_records as Record<string, unknown>[];
  assert.equal(orders.length, 2);
  assert.deepEqual(Object.keys(orders[0]).sort(), ["customer", "externalId", "scheduledDate", "status"]);
  assert.equal(calls[5].args.p_error, null);
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
  assert.deepEqual(calls.map((call) => call.fn), ["erp_sync_start", "erp_sync_finish"]);
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
