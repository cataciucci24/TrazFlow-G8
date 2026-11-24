import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveCompanyErpConfig, resolveCompanyErpContext, usesEnvErp, type CompanyErpDeps } from "./company.ts";
import { parseCompanyErpConnection } from "./config.ts";
import { ErpNextClient } from "./erpnext-client.ts";
import { MockErpClient } from "./mock-client.ts";
import { OdooClient } from "./odoo-client.ts";
import { ErpError } from "./types.ts";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

const ERPNEXT_A = {
  provider: "erpnext",
  baseUrl: "https://erp-a.example.com/",
  timeoutMs: 8000,
  itemGroup: "Productos",
  credentials: { apiKey: "key-a", apiSecret: "secret-a" },
};
const ODOO_B = {
  provider: "odoo",
  baseUrl: "https://odoo-b.example.com",
  odooDatabase: "b",
  odooUsername: "api@b",
  credentials: { apiKey: "key-b", apiSecret: null },
};

const ENV = {
  ERP_PROVIDER: "erpnext",
  ERP_BASE_URL: "https://demo.example.com",
  ERP_API_KEY: "env-key",
  ERP_API_SECRET: "env-secret",
  ERP_ENV_COMPANY_ID: A,
};

function deps(stored: Record<string, unknown>, env: Record<string, string | undefined> = {}): CompanyErpDeps & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    env,
    readConnection: async (companyId) => { reads.push(companyId); return stored[companyId] ?? null; },
  };
}

function rejectsConfig(raw: unknown, pattern: RegExp) {
  assert.throws(() => parseCompanyErpConnection(raw), (error) => {
    assert.ok(error instanceof ErpError);
    assert.equal(error.code, "config");
    assert.match(error.message, pattern);
    return true;
  });
}

test("dos empresas con ERPs distintos: cada una recibe el suyo", async () => {
  const d = deps({ [A]: ERPNEXT_A, [B]: ODOO_B });
  const a = await resolveCompanyErpContext(A, d);
  const b = await resolveCompanyErpContext(B, d);
  assert.ok(a?.client instanceof ErpNextClient);
  assert.ok(b?.client instanceof OdooClient);
  assert.deepEqual([a?.provider, a?.source, b?.provider, b?.source], ["erpnext", "company", "odoo", "company"]);
  assert.deepEqual(d.reads, [A, B], "cada empresa lee solo su configuración");
});

test("la configuración guardada se normaliza (URL sin barra final, timeout, Item Group)", async () => {
  const resolved = await resolveCompanyErpConfig(A, deps({ [A]: ERPNEXT_A }));
  assert.deepEqual(resolved?.config, {
    provider: "erpnext",
    baseUrl: "https://erp-a.example.com",
    apiKey: "key-a",
    apiSecret: "secret-a",
    timeoutMs: 8000,
    itemGroup: "Productos",
  });
});

test("sin configuración guardada ni ERP_ENV_COMPANY_ID, la empresa trabaja sin ERP", async () => {
  assert.equal(await resolveCompanyErpContext(B, deps({}, ENV)), null);
  assert.equal(await resolveCompanyErpContext(A, deps({}, { ...ENV, ERP_ENV_COMPANY_ID: undefined })), null);
});

test("transición: las variables ERP_* solo valen para la empresa de ERP_ENV_COMPANY_ID", async () => {
  const fromEnv = await resolveCompanyErpContext(A, deps({}, ENV));
  assert.equal(fromEnv?.source, "env");
  assert.ok(fromEnv?.client instanceof ErpNextClient);
  assert.equal(await resolveCompanyErpContext(B, deps({}, ENV)), null, "nunca se aplican a otra empresa");
  assert.equal(usesEnvErp(A, { ...ENV, ERP_PROVIDER: " " }), false);
  assert.equal(usesEnvErp(A, ENV), true);
});

test("la configuración guardada gana sobre las variables del servidor", async () => {
  const context = await resolveCompanyErpContext(A, deps({ [A]: { provider: "mock" } }, ENV));
  assert.equal(context?.source, "company");
  assert.ok(context?.client instanceof MockErpClient);
});

test("el mock de cada empresa es una instancia propia", async () => {
  const d = deps({ [A]: { provider: "mock" }, [B]: { provider: "mock" } });
  const a1 = await resolveCompanyErpContext(A, d);
  const a2 = await resolveCompanyErpContext(A, d);
  const b = await resolveCompanyErpContext(B, d);
  assert.equal(a1?.client, a2?.client);
  assert.notEqual(a1?.client, b?.client);
});

test("si la base falla, error reintentable sin detalles; un ErpError se propaga tal cual", async () => {
  await assert.rejects(
    resolveCompanyErpConfig(A, { readConnection: async () => { throw new Error("connection refused postgres://secreto"); } }),
    (error) => error instanceof ErpError && error.code === "unavailable" && error.retryable && !error.message.includes("secreto"),
  );
  await assert.rejects(
    resolveCompanyErpConfig(A, { readConnection: async () => { throw new ErpError("config", "sin service_role"); } }),
    (error) => error instanceof ErpError && error.code === "config",
  );
  await assert.rejects(resolveCompanyErpConfig("", deps({})), (error) => error instanceof ErpError && error.code === "config");
});

test("configuración guardada inválida: ErpError config con mensajes del panel, sin nombres de variables", () => {
  rejectsConfig(null, /no es válida/);
  rejectsConfig({ provider: "sap" }, /proveedor/);
  rejectsConfig({ ...ERPNEXT_A, baseUrl: null }, /Falta la URL/);
  rejectsConfig({ ...ERPNEXT_A, baseUrl: "ftp://erp" }, /http o https/);
  rejectsConfig({ ...ERPNEXT_A, timeoutMs: 10 }, /timeout/);
  rejectsConfig({ ...ERPNEXT_A, credentials: { apiKey: "k" } }, /API secret/);
  rejectsConfig({ ...ERPNEXT_A, credentials: null }, /API key/);
  rejectsConfig({ ...ODOO_B, odooUsername: " " }, /usuario de Odoo/);
  rejectsConfig({ ...ODOO_B, credentials: null }, /API key/);
  rejectsConfig({ provider: "mock", mockScenario: "explotar" }, /mock/);
  assert.throws(() => parseCompanyErpConnection({ ...ERPNEXT_A, credentials: null }), (error) => {
    assert.ok(error instanceof ErpError);
    assert.doesNotMatch(error.message, /ERP_/);
    return true;
  });
});

test("odoo no usa API secret y el mock toma sus valores por defecto", () => {
  assert.deepEqual(parseCompanyErpConnection(ODOO_B), {
    provider: "odoo",
    baseUrl: "https://odoo-b.example.com",
    database: "b",
    username: "api@b",
    apiKey: "key-b",
    timeoutMs: 10_000,
  });
  assert.deepEqual(parseCompanyErpConnection({ provider: "mock" }), { provider: "mock", mockScenario: "ok", mockDispatchStatus: "confirmed" });
});
