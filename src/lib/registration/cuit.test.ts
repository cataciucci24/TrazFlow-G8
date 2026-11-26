import assert from "node:assert/strict";
import { test } from "vitest";
import { isValidCuitDigits, normalizeCuit } from "./cuit.ts";

test("acepta CUIT válidos de sociedades y personas", () => {
  for (const digits of ["30712345671", "20123456786", "27111111117", "30500010912", "33693450239"]) {
    assert.equal(isValidCuitDigits(digits), true, digits);
  }
});

test("rechaza dígito verificador, prefijo, largo y resto 10", () => {
  for (const digits of ["30712345678", "99712345671", "3071234567", "307123456711", "30000000040", "3071234567a"]) {
    assert.equal(isValidCuitDigits(digits), false, digits);
  }
});

test("normaliza guiones, puntos y espacios al formato XX-XXXXXXXX-X", () => {
  assert.equal(normalizeCuit("30712345671"), "30-71234567-1");
  assert.equal(normalizeCuit("30-71234567-1"), "30-71234567-1");
  assert.equal(normalizeCuit(" 30.71234567.1 "), "30-71234567-1");
});

test("rechaza valores que no son CUIT", () => {
  for (const value of ["30-71234567-8", "30-7123456A-1", "", "   ", null, 30712345671, "30\t71234567\t1"]) {
    assert.equal(normalizeCuit(value), null, String(value));
  }
});
