import assert from "node:assert/strict";
import { test } from "vitest";

import { allowMockErp, canReuseStoredCredentials, describeSaveError, testErpConfig } from "./company-config.ts";
import { parseErpConfigForm, type ErpConfigFormInput } from "./config-form.ts";
import type { ErpConfigView } from "./types.ts";

const COMPANY = "aaaaaaaa-0000-0000-0000-000000000001";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const VIEW: ErpConfigView = {
  provider: "erpnext", baseUrl: "https://erp.example.com", odooDatabase: null, odooUsername: null, itemGroup: null,
  timeoutSeconds: null, mockScenario: null, mockDispatchStatus: null, apiKeyHint: "1234", apiSecretHint: "abcd",
  configuredAt: "2026-11-24T00:00:00Z", usesServerVariables: false, allowMock: true,
};

function input(overrides: Partial<ErpConfigFormInput>): ErpConfigFormInput {
  return {
    provider: "erpnext", baseUrl: "https://erp.example.com", odooDatabase: null, odooUsername: null, itemGroup: null,
    timeoutMs: null, mockScenario: null, mockDispatchStatus: null, apiKey: null, apiSecret: null, ...overrides,
  };
}

test("formulario: sin ERP no pide nada más", () => {
  assert.deepEqual(parseErpConfigForm(form({ provider: "none", baseUrl: "https://x" }), { allowMock: false }), {
    ok: true,
    input: input({ provider: null, baseUrl: null }),
  });
});

test("formulario: erpnext normaliza y valida URL y timeout", () => {
  const ok = parseErpConfigForm(form({
    provider: "erpnext", baseUrl: " https://erp.example.com/ ", apiKey: " k ", apiSecret: "s", itemGroup: "Grupo", timeoutSeconds: "15",
    odooDatabase: "ignorado",
  }), { allowMock: false });
  assert.ok(ok.ok);
  assert.deepEqual(ok.input, input({ baseUrl: "https://erp.example.com/", apiKey: "k", apiSecret: "s", itemGroup: "Grupo", timeoutMs: 15_000 }));

  const bad = parseErpConfigForm(form({ provider: "erpnext", baseUrl: "ftp://erp", timeoutSeconds: "0" }), { allowMock: false });
  assert.ok(!bad.ok);
  assert.equal(bad.errors.length, 2);
  assert.ok(!parseErpConfigForm(form({ provider: "erpnext" }), { allowMock: false }).ok, "la URL es obligatoria");
});

test("formulario: odoo exige base y usuario, y no usa API secret", () => {
  assert.ok(!parseErpConfigForm(form({ provider: "odoo", baseUrl: "https://odoo" }), { allowMock: false }).ok);
  const ok = parseErpConfigForm(form({ provider: "odoo", baseUrl: "https://odoo", odooDatabase: "db", odooUsername: "u", apiSecret: "x" }), { allowMock: false });
  assert.ok(ok.ok && ok.input.apiSecret === null);
});

test("formulario: el ERP simulado solo fuera de producción; proveedor desconocido se rechaza", () => {
  assert.ok(!parseErpConfigForm(form({ provider: "mock" }), { allowMock: false }).ok);
  const mock = parseErpConfigForm(form({ provider: "mock" }), { allowMock: true });
  assert.ok(mock.ok && mock.input.mockScenario === "ok" && mock.input.mockDispatchStatus === "confirmed");
  assert.ok(!parseErpConfigForm(form({ provider: "mock", mockScenario: "explotar" }), { allowMock: true }).ok);
  assert.ok(!parseErpConfigForm(form({ provider: "sap" }), { allowMock: true }).ok);
  assert.equal(allowMockErp({ VERCEL_ENV: "production" }), false);
  assert.equal(allowMockErp({ VERCEL_ENV: "preview" }), true);
  assert.equal(allowMockErp({}), true);
});

test("las credenciales guardadas solo se reutilizan con el mismo proveedor y la misma URL", () => {
  assert.equal(canReuseStoredCredentials(input({}), VIEW), true);
  assert.equal(canReuseStoredCredentials(input({ baseUrl: "https://erp.example.com/" }), VIEW), true);
  assert.equal(canReuseStoredCredentials(input({ baseUrl: "https://otro.example.com" }), VIEW), false);
  assert.equal(canReuseStoredCredentials(input({ provider: "odoo" }), VIEW), false);
});

test("probar conexión: con otra URL no lee las credenciales guardadas", async () => {
  let read = false;
  const health = await testErpConfig({
    companyId: COMPANY,
    input: input({ baseUrl: "https://atacante.example.com" }),
    view: VIEW,
    readStored: async () => { read = true; return { credentials: { apiKey: "guardada", apiSecret: "guardada" } }; },
  });
  assert.equal(read, false);
  assert.equal(health.status, "error");
  assert.ok(health.status === "error" && /API key/.test(health.message));
});

test("probar conexión: con la misma URL completa lo que falta con lo guardado y nunca lo devuelve", async () => {
  const asked: string[] = [];
  const health = await testErpConfig({
    companyId: COMPANY,
    input: input({ baseUrl: "http://127.0.0.1:9" }),
    view: { ...VIEW, baseUrl: "http://127.0.0.1:9" },
    readStored: async (companyId) => { asked.push(companyId); return { credentials: { apiKey: "clave-guardada", apiSecret: "secreto-guardado" } }; },
  });
  assert.deepEqual(asked, [COMPANY], "lee solo la configuración de su empresa");
  assert.equal(health.status, "error", "no hay ERP en ese puerto");
  assert.doesNotMatch(JSON.stringify(health), /clave-guardada|secreto-guardado/);
});

test("probar conexión con el ERP simulado", async () => {
  const health = await testErpConfig({ companyId: COMPANY, input: input({ provider: "mock", baseUrl: null }), view: VIEW });
  assert.equal(health.status, "ok");
});

test("mensajes de error al guardar", () => {
  assert.match(describeSaveError({ code: "42501" }), /Solo logística/);
  assert.equal(describeSaveError({ code: "22023", message: "Faltan las credenciales del ERP." }), "Faltan las credenciales del ERP.");
  assert.match(describeSaveError({ code: "23514" }), /no es válido/);
  assert.match(describeSaveError({ code: "08006", message: "detalle interno" }), /Intentá nuevamente/);
});
