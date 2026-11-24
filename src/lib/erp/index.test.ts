import assert from "node:assert/strict";
import { test } from "vitest";

import { readErpConfig } from "./config.ts";
import { ErpNextClient } from "./erpnext-client.ts";
import { createErpClient } from "./factory.ts";
import { ErpError } from "./types.ts";
import { MockErpClient } from "./mock-client.ts";
import { OdooClient } from "./odoo-client.ts";

const ERPNEXT_ENV = {
  ERP_PROVIDER: "erpnext",
  ERP_BASE_URL: "https://erp.example.com/",
  ERP_API_KEY: "key",
  ERP_API_SECRET: "secret",
};

/** Cliente de la configuración de entorno, como lo arma la fábrica para una empresa. */
function clientFor(env: Record<string, string | undefined>, companyId?: string) {
  return createErpClient(readErpConfig(env), companyId);
}

const ODOO_ENV = {
  ERP_PROVIDER: "odoo",
  ERP_BASE_URL: "http://localhost:8069/",
  ERP_ODOO_DB: "trazflow",
  ERP_ODOO_USER: "api@trazflow.local",
  ERP_API_KEY: "odoo-key",
};

function rejectsConfig(env: Record<string, string | undefined>, pattern: RegExp) {
  assert.throws(() => readErpConfig(env), (error) => {
    assert.ok(error instanceof ErpError);
    assert.equal(error.code, "config");
    assert.match(error.message, pattern);
    return true;
  });
}

test("sin ERP_PROVIDER se usa el mock", () => {
  assert.deepEqual(readErpConfig({}), { provider: "mock", mockScenario: "ok", mockDispatchStatus: "confirmed" });
  assert.ok(clientFor({}, "company-1") instanceof MockErpClient);
});

test("el mock se reutiliza por empresa y escenario para detectar duplicados entre requests", () => {
  assert.equal(clientFor({}, "company-1"), clientFor({}, "company-1"));
  const failing = clientFor({ ERP_MOCK_SCENARIO: "timeout" }, "company-1");
  assert.notEqual(failing, clientFor({}, "company-1"));
  const draft = clientFor({ ERP_MOCK_DISPATCH_STATUS: "draft" }, "company-1");
  assert.notEqual(draft, clientFor({}, "company-1"), "el estado del remito simulado también separa instancias");
});

test("TRZ-112: dos empresas con el mock no comparten reportes; sin empresa, instancia nueva", () => {
  assert.notEqual(clientFor({}, "company-1"), clientFor({}, "company-2"));
  assert.notEqual(clientFor({}), clientFor({}), "Probar conexión no reutiliza el mock de ninguna empresa");
});

test("ERP_MOCK_DISPATCH_STATUS elige qué responde getDispatchStatus en el mock", async () => {
  assert.equal(readErpConfig({ ERP_MOCK_DISPATCH_STATUS: " draft " }).provider, "mock");
  assert.deepEqual(readErpConfig({ ERP_MOCK_DISPATCH_STATUS: "draft" }), { provider: "mock", mockScenario: "ok", mockDispatchStatus: "draft" });
  rejectsConfig({ ERP_MOCK_DISPATCH_STATUS: "submitted" }, /ERP_MOCK_DISPATCH_STATUS/);
  const status = await clientFor({ ERP_MOCK_DISPATCH_STATUS: "draft" }, "company-1").getDispatchStatus("dispatch:SAL-ORD-2026-00099");
  assert.deepEqual(status, { status: "draft", erpReference: null });
});

test("con erpnext se exigen URL y credenciales", () => {
  rejectsConfig({ ERP_PROVIDER: "erpnext" }, /ERP_BASE_URL, ERP_API_KEY, ERP_API_SECRET/);
  rejectsConfig({ ...ERPNEXT_ENV, ERP_API_SECRET: " " }, /ERP_API_SECRET/);
  rejectsConfig({ ...ERPNEXT_ENV, ERP_BASE_URL: "no es url" }, /ERP_BASE_URL/);
  rejectsConfig({ ...ERPNEXT_ENV, ERP_BASE_URL: "ftp://erp.example.com" }, /http/);
  rejectsConfig({ ...ERPNEXT_ENV, ERP_TIMEOUT_MS: "-5" }, /ERP_TIMEOUT_MS/);
});

test("la configuración de erpnext se normaliza", () => {
  assert.deepEqual(readErpConfig(ERPNEXT_ENV), {
    provider: "erpnext",
    baseUrl: "https://erp.example.com",
    apiKey: "key",
    apiSecret: "secret",
    timeoutMs: 10_000,
  });
  assert.ok(clientFor(ERPNEXT_ENV, "company-1") instanceof ErpNextClient);
});

test("con odoo se exigen URL, base, usuario y API key (no API secret)", () => {
  rejectsConfig({ ERP_PROVIDER: "odoo" }, /Faltan variables de entorno del ERP: ERP_BASE_URL, ERP_ODOO_DB, ERP_ODOO_USER, ERP_API_KEY\./);
  for (const name of ["ERP_BASE_URL", "ERP_ODOO_DB", "ERP_ODOO_USER", "ERP_API_KEY"] as const) {
    rejectsConfig({ ...ODOO_ENV, [name]: " " }, new RegExp(`^Faltan variables de entorno del ERP: ${name}\\.$`));
  }
  rejectsConfig({ ...ODOO_ENV, ERP_BASE_URL: "no es url" }, /ERP_BASE_URL/);
  rejectsConfig({ ...ODOO_ENV, ERP_BASE_URL: "ftp://odoo.example.com" }, /http/);
  rejectsConfig({ ...ODOO_ENV, ERP_TIMEOUT_MS: "1.5" }, /ERP_TIMEOUT_MS/);
});

test("la configuración de odoo se normaliza y la fábrica devuelve OdooClient", () => {
  assert.deepEqual(readErpConfig({ ...ODOO_ENV, ERP_API_SECRET: "ignorado", ERP_ITEM_GROUP: "ignorado" }), {
    provider: "odoo",
    baseUrl: "http://localhost:8069",
    database: "trazflow",
    username: "api@trazflow.local",
    apiKey: "odoo-key",
    timeoutMs: 10_000,
  });
  assert.equal(readErpConfig({ ...ODOO_ENV, ERP_PROVIDER: " odoo ", ERP_TIMEOUT_MS: "2500" }).provider, "odoo");
  const client = clientFor(ODOO_ENV, "company-1");
  assert.ok(client instanceof OdooClient);
  assert.equal(client.provider, "odoo");
});

test("proveedor o escenario desconocidos fallan con error de configuración", () => {
  rejectsConfig({ ERP_PROVIDER: "softplan" }, /ERP_PROVIDER inválido: "softplan"\. Valores posibles: mock, erpnext, odoo\./);
  rejectsConfig({ ERP_MOCK_SCENARIO: "explotar" }, /ERP_MOCK_SCENARIO/);
});
