import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeErpErrorText } from "./sanitize.ts";

test("deja pasar un mensaje normal", () => {
  assert.equal(sanitizeErpErrorText("El ERP no respondió a tiempo (mock)."), "El ERP no respondió a tiempo (mock).");
});

test("oculta URLs, también las privadas", () => {
  const text = sanitizeErpErrorText("Falló GET https://erp.interno.local:8080/api/resource/Item?x=1 y http://10.0.0.5/x");
  assert.equal(text, "Falló GET [url oculta] y [url oculta]");
});

test("oculta credenciales y tokens", () => {
  assert.equal(sanitizeErpErrorText("Authorization: token abc123:def456 rechazado"), "Authorization [oculto] rechazado");
  assert.equal(sanitizeErpErrorText("Bearer eyJhbGciOi.payload.sig"), "Bearer [oculto]");
  assert.equal(sanitizeErpErrorText("api_key=AKIA123 secret: s3cr3t password=hunter2"), "api_key=[oculto] secret=[oculto] password=[oculto]");
  assert.equal(sanitizeErpErrorText("clave a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"), "clave [oculto]");
});

test("oculta correos y conserva UUIDs y códigos del contrato", () => {
  assert.equal(
    sanitizeErpErrorText("Usuario ops@empresa.com sin permiso sobre 6f1c2a52-1d5e-4b55-9a0e-2a5a8c1f0b11 (unauthorized)"),
    "Usuario [correo oculto] sin permiso sobre 6f1c2a52-1d5e-4b55-9a0e-2a5a8c1f0b11 (unauthorized)",
  );
});

test("el caso guardado en el test SQL", () => {
  assert.equal(
    sanitizeErpErrorText("El ERP rechazó el reporte (mock). token abc:def https://erp.interno.local/api"),
    "El ERP rechazó el reporte (mock). token [oculto] [url oculta]",
  );
});

test("quita caracteres de control, recorta y trunca", () => {
  assert.equal(sanitizeErpErrorText("  línea 1\nlínea\t2\u0000  "), "línea 1 línea 2");
  const long = sanitizeErpErrorText("palabra ".repeat(100));
  assert.equal(long?.length, 300);
  assert.ok(long?.endsWith("…"));
});

test("vacío o no texto da null", () => {
  assert.equal(sanitizeErpErrorText(null), null);
  assert.equal(sanitizeErpErrorText(42), null);
  assert.equal(sanitizeErpErrorText("   "), null);
});
