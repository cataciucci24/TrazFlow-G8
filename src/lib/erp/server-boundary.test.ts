import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/** Chequeos estáticos de que la configuración y las credenciales del ERP no llegan al navegador. */

const SRC = join(import.meta.dirname, "..", "..");
const ERP_DIR = import.meta.dirname;

/** Módulos de src/lib/erp que el navegador puede importar: no leen entorno ni hacen red. */
const CLIENT_SAFE = new Set(["types.ts", "client.ts", "validation.ts", "fixtures.ts", "mock-scenarios.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("los módulos ERP con entorno o red importan server-only", () => {
  for (const path of sourceFiles(ERP_DIR)) {
    const name = relative(ERP_DIR, path);
    if (CLIENT_SAFE.has(name)) continue;
    assert.match(readFileSync(path, "utf8"), /^import "server-only";$/m, `${name} debe importar "server-only"`);
  }
});

test("los módulos ERP seguros para el cliente no leen el entorno", () => {
  for (const name of CLIENT_SAFE) {
    assert.doesNotMatch(readFileSync(join(ERP_DIR, name), "utf8"), /process\.env/, name);
  }
});

test("ninguna variable ERP se expone con NEXT_PUBLIC_", () => {
  for (const path of sourceFiles(SRC)) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /NEXT_PUBLIC_ERP/, relative(SRC, path));
  }
});

test("los componentes cliente solo importan tipos del ERP", () => {
  const erpImport = /from\s+["'](?:@\/lib\/erp|(?:\.\.?\/)+(?:lib\/)?erp)(?:\/([\w-]+))?(?:\.ts)?["']/g;
  for (const path of sourceFiles(SRC)) {
    const code = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/.test(code)) continue;
    for (const [, module] of code.matchAll(erpImport)) {
      assert.ok(module && CLIENT_SAFE.has(`${module}.ts`), `${relative(SRC, path)} importa lib/erp/${module ?? "index"}`);
    }
  }
});
