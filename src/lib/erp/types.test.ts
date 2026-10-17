import assert from "node:assert/strict";
import { test } from "node:test";

import { ErpError, buildDispatchIdempotencyKey, erpErrorCodeFromStatus } from "./types.ts";

test("la clave de idempotencia depende solo de la orden externa", () => {
  assert.equal(buildDispatchIdempotencyKey("SAL-ORD-2026-00012"), "dispatch:SAL-ORD-2026-00012");
  assert.equal(buildDispatchIdempotencyKey(" SAL-ORD-2026-00012 "), buildDispatchIdempotencyKey("SAL-ORD-2026-00012"));
  assert.throws(() => buildDispatchIdempotencyKey("  "));
});

test("los status HTTP se traducen a códigos del contrato", () => {
  assert.equal(erpErrorCodeFromStatus(401), "unauthorized");
  assert.equal(erpErrorCodeFromStatus(403), "unauthorized");
  assert.equal(erpErrorCodeFromStatus(404), "not_found");
  assert.equal(erpErrorCodeFromStatus(409), "conflict");
  assert.equal(erpErrorCodeFromStatus(417), "validation");
  assert.equal(erpErrorCodeFromStatus(422), "validation");
  assert.equal(erpErrorCodeFromStatus(429), "rate_limited");
  assert.equal(erpErrorCodeFromStatus(500), "unavailable");
  assert.equal(erpErrorCodeFromStatus(503), "unavailable");
});

test("solo los errores temporales son reintentables", () => {
  for (const code of ["timeout", "network", "unavailable", "rate_limited"] as const) {
    assert.equal(new ErpError(code, "x").retryable, true, code);
  }
  for (const code of ["config", "unauthorized", "validation", "not_found", "conflict", "invalid_response"] as const) {
    assert.equal(new ErpError(code, "x").retryable, false, code);
  }
});
