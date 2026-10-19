import assert from "node:assert/strict";
import { test } from "node:test";

import type { ErpClient } from "../erp/client.ts";
import { MockErpClient } from "../erp/mock-client.ts";
import { ErpError } from "../erp/types.ts";
import { checkErpHealth } from "./health.ts";

const NOW = () => new Date("2026-10-19T12:00:00Z");

test("conexión activa", async () => {
  const health = await checkErpHealth({ getClient: () => new MockErpClient({ now: NOW }), now: NOW });
  assert.deepEqual(health, { status: "ok", provider: "mock", latencyMs: 0, checkedAt: "2026-10-19T12:00:00.000Z" });
});

test("credenciales inválidas", async () => {
  const health = await checkErpHealth({ getClient: () => new MockErpClient({ scenario: "unauthorized" }), now: NOW });
  assert.equal(health.status, "error");
  assert.equal(health.status === "error" && health.code, "unauthorized");
});

test("un ERP que no responde corta por timeout", async () => {
  const hanging = { provider: "mock", healthcheck: () => new Promise(() => {}) } as unknown as ErpClient;
  const started = Date.now();
  const health = await checkErpHealth({ getClient: () => hanging, timeoutMs: 30, now: NOW });
  assert.ok(Date.now() - started < 1000);
  assert.equal(health.status === "error" && health.code, "timeout");
});

test("configuración inválida", async () => {
  const health = await checkErpHealth({ getClient: () => { throw new ErpError("config", "ERP_PROVIDER inválido: \"x\"."); }, now: NOW });
  assert.deepEqual(health, { status: "error", code: "config", message: "ERP_PROVIDER inválido: \"x\".", checkedAt: "2026-10-19T12:00:00.000Z" });
});

test("el mensaje se sanitiza y un error inesperado no filtra detalles", async () => {
  const leaky = { provider: "erpnext", healthcheck: async () => { throw new ErpError("network", "No conecta a https://erp.privado.local token a:b"); } } as unknown as ErpClient;
  const health = await checkErpHealth({ getClient: () => leaky, now: NOW });
  assert.equal(health.status === "error" && health.message, "No conecta a [url oculta] token [oculto]");

  const crash = { provider: "erpnext", healthcheck: async () => { throw new TypeError("Authorization: token a:b at fetch"); } } as unknown as ErpClient;
  const unknown = await checkErpHealth({ getClient: () => crash, now: NOW });
  assert.deepEqual(unknown.status === "error" && [unknown.code, unknown.message], ["unknown", "No se pudo verificar la conexión con el ERP."]);
});
