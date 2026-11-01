import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as Actions from "./subscription-actions";
import * as payments from "./payments.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function harness({ role = "logistics_manager", data = "canceled", error = null, throws = false }:
  { role?: string; data?: unknown; error?: unknown; throws?: boolean } = {}) {
  const calls: unknown[][] = [], paths: unknown[][] = [];
  const compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL("./subscription-actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    if (name === "./payments") return payments;
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
function form(confirmed = true) {
  const f = new FormData();
  if (confirmed) f.set("confirmed", "on");
  return f;
}

test("verifica rol y confirmación antes de llamar la RPC", async () => {
  for (const role of ["driver_operator", "warehouse_operator"]) {
    const h = harness({ role });
    assert.match((await h.api.cancelSubscription({ error: null }, form())).error!, /permisos/);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.match((await h.api.cancelSubscription({ error: null }, form(false))).error!, /Confirmá/);
  assert.equal(h.calls.length, 0);
});

test("éxito y reintento invalidan el layout y vuelven a la cuenta", async () => {
  for (const data of ["canceled", "already_canceled"]) {
    const h = harness({ data });
    await assert.rejects(h.api.cancelSubscription({ error: null }, form()), /redirect:\/dashboard\/account\?done=subscription-canceled/);
    assert.deepEqual(h.calls, [["cancel_company_subscription", { p_confirmed: true }]]);
    assert.deepEqual(h.paths, [["/dashboard", "layout"]]);
  }
});

test("los rechazos y fallos se informan sin redirigir", async () => {
  assert.match((await harness({ data: "no_paid_period" }).api.cancelSubscription({ error: null }, form())).error!, /período pagado/);
  assert.match((await harness({ data: "unassigned" }).api.cancelSubscription({ error: null }, form())).error!, /plan asignado/);
  assert.match((await harness({ data: null, error: { code: "42501" } }).api.cancelSubscription({ error: null }, form())).error!, /permisos/);
  assert.match((await harness({ throws: true }).api.cancelSubscription({ error: null }, form())).error!, /reintentar/);
});
