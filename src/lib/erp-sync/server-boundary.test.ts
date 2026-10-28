import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/** La sincronización (cliente ERP, entorno, Supabase) no puede llegar al navegador. */

const SRC = join(import.meta.dirname, "..", "..");
const SYNC_DIR = import.meta.dirname;

/** Módulos de src/lib/erp-sync que un componente cliente puede importar. */
const CLIENT_SAFE = new Set(["types.ts", "units.ts", "actions.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("los módulos de sincronización con entorno o red importan server-only", () => {
  for (const path of sourceFiles(SYNC_DIR)) {
    const name = relative(SYNC_DIR, path);
    if (CLIENT_SAFE.has(name)) continue;
    assert.match(readFileSync(path, "utf8"), /^import "server-only";$/m, `${name} debe importar "server-only"`);
  }
});

test("las acciones de sincronización son Server Actions", () => {
  assert.match(readFileSync(join(SYNC_DIR, "actions.ts"), "utf8"), /^"use server";$/m);
});

test("los tipos y unidades no leen el entorno", () => {
  for (const name of ["types.ts", "units.ts"]) {
    assert.doesNotMatch(readFileSync(join(SYNC_DIR, name), "utf8"), /process\.env/, name);
  }
});

test("los componentes cliente solo importan tipos, unidades o acciones de la sincronización", () => {
  const syncImport = /from\s+["'](?:@\/lib\/erp-sync|(?:\.\.?\/)+(?:lib\/)?erp-sync)(?:\/([\w-]+))?(?:\.ts)?["']/g;
  for (const path of sourceFiles(SRC)) {
    const code = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/.test(code)) continue;
    for (const [, module] of code.matchAll(syncImport)) {
      assert.ok(module && CLIENT_SAFE.has(`${module}.ts`), `${relative(SRC, path)} importa lib/erp-sync/${module ?? "index"}`);
    }
  }
});

test("TRZ-104: ningún componente cliente importa el cliente service_role ni los cron", () => {
  const forbidden = /from\s+["'](?:@\/lib\/(?:supabase\/service|cron(?:\/[\w-]+)?)|(?:\.\.?\/)+(?:lib\/)?(?:supabase\/service|cron(?:\/[\w-]+)?))(?:\.ts)?["']/;
  for (const path of sourceFiles(SRC)) {
    const code = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/.test(code)) continue;
    assert.doesNotMatch(code, forbidden, relative(SRC, path));
  }
});

test("TRZ-104: los módulos de los cron importan server-only y solo los usan los Route Handlers de /api/cron", () => {
  const cronDir = join(SRC, "lib", "cron");
  for (const path of sourceFiles(cronDir)) {
    assert.match(readFileSync(path, "utf8"), /^import "server-only";$/m, `${relative(SRC, path)} debe importar server-only`);
  }
  const users = /from\s+["'](?:@\/lib\/supabase\/service|@\/lib\/cron\/[\w-]+)["']/;
  for (const path of sourceFiles(SRC)) {
    const name = relative(SRC, path);
    if (!users.test(readFileSync(path, "utf8"))) continue;
    assert.match(name, /^app\/api\/cron\/[\w-]+\/route\.ts$/, `${name} usa service_role o un cron fuera de /api/cron`);
  }
});
