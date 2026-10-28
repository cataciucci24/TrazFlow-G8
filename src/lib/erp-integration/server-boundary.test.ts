import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/** El panel de integración (cliente ERP, entorno, Supabase) no puede llegar al navegador. */

const SRC = join(import.meta.dirname, "..", "..");
const DIR = import.meta.dirname;

/** Módulos de src/lib/erp-integration que un componente cliente puede importar. */
const CLIENT_SAFE = new Set(["types.ts", "filters.ts", "status.ts", "sanitize.ts", "actions.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("los módulos del panel con entorno, red o base importan server-only", () => {
  for (const path of sourceFiles(DIR)) {
    const name = relative(DIR, path);
    if (CLIENT_SAFE.has(name)) continue;
    assert.match(readFileSync(path, "utf8"), /^import "server-only";$/m, `${name} debe importar "server-only"`);
  }
});

test("los módulos seguros para el cliente no leen el entorno ni importan módulos de servidor", () => {
  for (const name of ["types.ts", "filters.ts", "status.ts", "sanitize.ts"]) {
    const code = readFileSync(join(DIR, name), "utf8");
    assert.doesNotMatch(code, /process\.env/, name);
    assert.doesNotMatch(code, /from\s+["'][^"']*(erp\/index|erp\/config|supabase|server-only|health|queries|outbox|config)/, name);
  }
});

test("los componentes cliente solo importan tipos, utilidades puras o acciones del panel", () => {
  const panelImport = /from\s+["'](?:@\/lib\/erp-integration|(?:\.\.?\/)+(?:lib\/)?erp-integration)(?:\/([\w-]+))?(?:\.ts)?["']/g;
  for (const path of sourceFiles(SRC)) {
    const code = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/.test(code)) continue;
    for (const [, module] of code.matchAll(panelImport)) {
      assert.ok(module && CLIENT_SAFE.has(`${module}.ts`), `${relative(SRC, path)} importa lib/erp-integration/${module ?? "index"}`);
    }
  }
});

test("cada Server Action del panel exige sesión y rol de logística antes de hacer algo", () => {
  const code = readFileSync(join(DIR, "actions.ts"), "utf8");
  assert.match(code, /^"use server";$/m);
  const actions = [...code.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
  assert.ok(actions.length >= 2, "se esperaban las acciones del panel");
  for (const [, name, body] of actions) {
    const lines = body.trim().split("\n").map((line) => line.trim());
    assert.match(lines[0], /^const profile = await requireUserProfile\(\);$/, `${name}: primero requireUserProfile()`);
    assert.match(lines[1], /^if \(!hasRole\(profile, "logistics_manager"\)\) return FORBIDDEN;$/, `${name}: después el rol`);
  }
});

test("la página del panel redirige a quien no es logística", () => {
  const page = readFileSync(join(SRC, "app", "dashboard", "integrations", "page.tsx"), "utf8");
  assert.match(page, /requireUserProfile\(\);\s*\n\s*if \(!hasRole\(profile, "logistics_manager"\)\) redirect\("\/dashboard"\);/);
});

test("TRZ-104: el panel lee con la sesión del usuario, nunca con service_role", () => {
  for (const path of sourceFiles(DIR)) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /supabase\/service|SUPABASE_SERVICE_ROLE_KEY/, relative(DIR, path));
  }
});
