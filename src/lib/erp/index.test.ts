import assert from "node:assert/strict";
import { test } from "node:test";

import { readErpConfig } from "./config.ts";
import { ErpNextClient } from "./erpnext-client.ts";
import { ErpError, getErpClient } from "./index.ts";
import { MockErpClient } from "./mock-client.ts";

const ERPNEXT_ENV = {
  ERP_PROVIDER: "erpnext",
  ERP_BASE_URL: "https://erp.example.com/",
  ERP_API_KEY: "key",
  ERP_API_SECRET: "secret",
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
  assert.deepEqual(readErpConfig({}), { provider: "mock", mockScenario: "ok" });
  assert.ok(getErpClient("company-1", {}) instanceof MockErpClient);
});

test("el mock se reutiliza por escenario para detectar duplicados entre requests", () => {
  assert.equal(getErpClient(undefined, {}), getErpClient(undefined, {}));
  const failing = getErpClient(undefined, { ERP_MOCK_SCENARIO: "timeout" });
  assert.notEqual(failing, getErpClient(undefined, {}));
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
  assert.ok(getErpClient("company-1", ERPNEXT_ENV) instanceof ErpNextClient);
});

test("proveedor o escenario desconocidos fallan con error de configuración", () => {
  rejectsConfig({ ERP_PROVIDER: "softplan" }, /ERP_PROVIDER/);
  rejectsConfig({ ERP_MOCK_SCENARIO: "explotar" }, /ERP_MOCK_SCENARIO/);
});
