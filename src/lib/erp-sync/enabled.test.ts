import assert from "node:assert/strict";
import { test } from "vitest";

import { isErpEnabled, readProvider } from "./enabled.ts";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

const saved = (providers: Record<string, string>) => async (companyId: string) => providers[companyId] ?? null;

test("TRZ-112: el ERP se decide por empresa según la configuración guardada", async () => {
  const read = saved({ [A]: "erpnext" });
  assert.equal(await isErpEnabled(A, read, {}), true);
  assert.equal(await isErpEnabled(B, read, {}), false, "la otra empresa sigue en modo manual");
});

test("ERP_PROVIDER solo habilita el ERP de la empresa de ERP_ENV_COMPANY_ID", async () => {
  const none = saved({});
  assert.equal(await isErpEnabled(A, none, { ERP_PROVIDER: "erpnext" }), false, "sin ERP_ENV_COMPANY_ID no aplica a nadie");
  assert.equal(await isErpEnabled(A, none, { ERP_PROVIDER: "erpnext", ERP_ENV_COMPANY_ID: A }), true);
  assert.equal(await isErpEnabled(B, none, { ERP_PROVIDER: "erpnext", ERP_ENV_COMPANY_ID: A }), false);
  assert.equal(await isErpEnabled(A, none, { ERP_PROVIDER: "  ", ERP_ENV_COMPANY_ID: A }), false);
});

test("sin empresa no hay ERP y no se consulta la base", async () => {
  assert.equal(await isErpEnabled("", async () => { throw new Error("no debería leer"); }, {}), false);
});

test("readProvider llama a erp_company_provider y propaga el error sin datos", async () => {
  const calls: unknown[] = [];
  const ok = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: "odoo", error: null }; } };
  assert.equal(await readProvider(ok, A), "odoo");
  assert.deepEqual(calls, [["erp_company_provider", { p_company_id: A }]]);
  const empty = { rpc: async () => ({ data: null, error: null }) };
  assert.equal(await readProvider(empty, A), null);
  const failing = { rpc: async () => ({ data: null, error: { code: "42501" } }) };
  await assert.rejects(readProvider(failing, B), /42501/);
});
