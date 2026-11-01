import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as Actions from "./actions";
import * as change from "./change.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function harness({ role = "logistics_manager", data = "changed", error = null, throws = false }:
  { role?: string; data?: unknown; error?: unknown; throws?: boolean } = {}) {
  const calls: unknown[][] = [], paths: unknown[][] = [];
  const compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    if (name === "./change") return change;
    if (name === "@/lib/auth/session") return {
      requireUserProfile: async () => ({ role }), hasRole: (profile: { role: string }, expected: string) => profile.role === expected,
    };
    if (name === "@/lib/supabase/server") return { createClient: async () => ({ rpc: async (...args: unknown[]) => {
      calls.push(args); if (throws) throw new Error("network"); return { data, error };
    } }) };
    if (name === "next/cache") return { revalidatePath: (...args: unknown[]) => paths.push(args) };
    if (name === "next/navigation") return { redirect: (url: string) => { throw new Error(`redirect:${url}`); } };
    throw new Error(name);
  }, compiled, compiled.exports);
  return { api: compiled.exports as typeof Actions, calls, paths };
}
function form() {
  const f = new FormData();
  for (const [key, value] of Object.entries({ targetCode: "starter", expectedCode: "growth", assignedAt: "2026-10-01T00:00:00Z", requestId: "10000000-0000-4000-8000-000000000001", confirmed: "on" })) f.set(key, value);
  return f;
}
test("acción verifica rol y confirmación antes de llamar la RPC", async () => {
  for (const role of ["driver_operator", "warehouse_operator"]) {
    const h = harness({ role }); assert.match((await h.api.changeCompanyPlan({ error: null }, form())).error!, /permisos/); assert.equal(h.calls.length, 0);
  }
  const h = harness(); const f = form(); f.delete("confirmed");
  assert.match((await h.api.changeCompanyPlan({ error: null }, f)).error!, /Confirmá/); assert.equal(h.calls.length, 0);
});
test("éxito y reintento invalidan layout y navegan al plan actualizado sin recalcular ni reiniciar consumo", async () => {
  for (const data of ["changed", "already_applied"]) {
    const h = harness({ data });
    await assert.rejects(h.api.changeCompanyPlan({ error: null }, form()), /redirect:\/dashboard\/account\?done=plan-changed/);
    assert.deepEqual(h.paths, [["/dashboard", "layout"]]);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], "change_company_plan");
    assert.ok(!("company_id" in (h.calls[0][1] as object)));
  }
});
test("resultados de negocio muestran error y conservan el formulario sin navegar", async () => {
  for (const data of Object.keys(change.planChangeMessages)) {
    const h = harness({ data }); assert.deepEqual(await h.api.changeCompanyPlan({ error: null }, form()), { error: change.planChangeMessages[data] }); assert.equal(h.paths.length, 0);
  }
});
test("errores de permisos, red, migración ausente y respuestas inesperadas no muestran éxito", async () => {
  for (const options of [{ error: { code: "42501" } }, { error: { code: "PGRST202" } }, { throws: true }, { data: null }, { data: "unexpected" }]) {
    const h = harness(options); assert.ok((await h.api.changeCompanyPlan({ error: null }, form())).error); assert.equal(h.paths.length, 0);
  }
});
