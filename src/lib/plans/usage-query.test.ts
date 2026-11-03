import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as Query from "./usage-query";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function harness(data: unknown, error: unknown = null, throws = false) {
 const calls: unknown[][] = [];
 const compiled = { exports: {} };
 const source = ts.transpileModule(readFileSync(new URL("./usage-query.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
 new Function("require", "module", "exports", source)((name: string) => {
  if (name === "server-only") return {};
  if (name === "react") return { cache: (fn: unknown) => fn };
  if (name === "@/lib/supabase/server") return { createClient: async () => ({ rpc: async (...args: unknown[]) => {
   calls.push(args); if (throws) throw new Error("network"); return { data, error };
  } }) };
  throw new Error(name);
 }, compiled, compiled.exports);
 return { api: compiled.exports as typeof Query, calls };
}
test("consumo viene de RPC autenticada sin aceptar empresa desde el cliente", async () => {
 const { api, calls } = harness([{ operators: 2, pallets: 8, month_start: "2026-10-01", pallets_complete: false }]);
 assert.deepEqual(await api.getCompanyPlanUsage(), { available: true, usage: { operators: 2, pallets: 8, monthStart: "2026-10-01", palletsComplete: false } });
 assert.deepEqual(calls, [["get_company_plan_usage"]]);
});
test("error, migración ausente, respuesta incompleta y falla de red no se interpretan como cero", async () => {
 for (const args of [[null, { code: "PGRST202" }], [[], null], [[{ operators: -1 }], null], [null, null, true]] as const) {
  const { api } = harness(args[0], args[1], args.length > 2 ? args[2] : false);
  assert.deepEqual(await api.getCompanyPlanUsage(), { available: false });
 }
});
