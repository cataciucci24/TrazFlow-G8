import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** La consulta del stock según ERP no puede llegar al navegador; los tipos sí (los usa el formulario de alta). */

const DIR = import.meta.dirname;

test("la consulta importa server-only y los tipos no leen el entorno", () => {
  assert.match(readFileSync(join(DIR, "queries.ts"), "utf8"), /^import "server-only";$/m);
  assert.doesNotMatch(readFileSync(join(DIR, "types.ts"), "utf8"), /process\.env|server-only|supabase/);
});

test("el selector de lote del ERP (componente cliente) solo importa los tipos", () => {
  const code = readFileSync(join(DIR, "..", "..", "components", "pallets", "erp-lot-field.tsx"), "utf8");
  assert.match(code, /^"use client";/);
  assert.doesNotMatch(code, /erp-stock\/queries/);
});
