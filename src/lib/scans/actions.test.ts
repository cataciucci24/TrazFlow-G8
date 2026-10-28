import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { getPalletScanDetails } from "./actions";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function harness() {
  const calls: unknown[] = [];
  let authenticated = true;
  let response: { data: unknown; error: unknown } = { data: [], error: null };
  const compiled = { exports: {} as { getPalletScanDetails: typeof getPalletScanDetails } };
  const code = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name.endsWith("auth/session")) return { requireUserProfile: async () => { if (!authenticated) throw new Error("Unauthenticated"); } };
    if (name.endsWith("supabase/server")) return { createClient: async () => ({ rpc: async (...args: unknown[]) => { calls.push(args); return response; } }) };
    return require(name);
  }, compiled, compiled.exports);
  return { call: compiled.exports.getPalletScanDetails, calls, setResponse: (value: typeof response) => { response = value; }, logout: () => { authenticated = false; } };
}

test("autentica antes de consultar y rechaza códigos vacíos o demasiado largos", async () => {
  const h = harness();
  for (const code of ["  ", "x".repeat(513), null, {}]) assert.ok((await h.call(code as string)).error);
  assert.equal(h.calls.length, 0);
  h.logout();
  await assert.rejects(h.call("PAL-1"), /Unauthenticated/);
  assert.equal(h.calls.length, 0);
});

test("consulta el QR normalizado y solo devuelve la proyección pública", async () => {
  const h = harness();
  const pallet = { qr_code: "PAL-1", product_name: "Arroz", product_sku: "ARR", batch_number: "L-1", quantity: 12.5,
    unit_of_measure: "kilogramos", physical_location: "DEP-01 / A01", last_event_type: "location_changed",
    last_event_at: "2026-10-27T13:00:00Z", actor_name: "Nahir", actor_role: "warehouse_operator" };
  h.setResponse({ data: [{ ...pallet, email: "privado@test.local", user_id: "secret", details: { email: "secret" } }], error: null });
  assert.deepEqual(await h.call(" PAL-1 "), { pallet, error: null });
  assert.deepEqual(h.calls, [["get_pallet_scan_details", { p_qr_code: "PAL-1" }]]);
});

test("no revela si el pallet es ajeno o inexistente y distingue un error de consulta", async () => {
  const h = harness();
  const missing = await h.call("PAL-1");
  assert.equal(missing.pallet, null);
  assert.match(missing.error!, /no existe o no está disponible/);
  h.setResponse({ data: null, error: { message: "private DB error" } });
  const failed = await h.call("PAL-1");
  assert.equal(failed.pallet, null);
  assert.match(failed.error!, /No se pudo consultar/);
  assert.doesNotMatch(JSON.stringify(failed), /private DB error/);
});
