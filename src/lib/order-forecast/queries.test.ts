import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { getCustomerOrderForecasts } from "./queries";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function harness(role = "logistics_manager") {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const responses = new Map<string, { data: unknown[] | null; error: unknown }>();
  const compiled = { exports: {} as { getCustomerOrderForecasts: typeof getCustomerOrderForecasts } };
  const code = ts.transpileModule(readFileSync(new URL("./queries.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "server-only") return {};
    if (name.endsWith("auth/session")) return {
      requireUserProfile: async () => ({ id: "user", companyId: "company", role }),
      hasRole: (profile: { role: string }, ...roles: string[]) => roles.includes(profile.role),
    };
    if (name.endsWith("supabase/server")) return { createClient: async () => ({ from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "not", "lte", "order"]) query[method] = (...args: unknown[]) => {
        calls.push({ table, method, args }); return query;
      };
      query.range = async (start: number, end: number) => {
        calls.push({ table, method: "range", args: [start, end] });
        const response = responses.get(table) ?? { data: [], error: null };
        return { ...response, data: response.data?.slice(start, end + 1) ?? null };
      };
      return query;
    } }) };
    if (name === "./forecast") return require("./forecast.ts");
    return require(name);
  }, compiled, compiled.exports);
  return { call: compiled.exports.getCustomerOrderForecasts, calls,
    set: (table: string, data: unknown[] | null, error: unknown = null) => responses.set(table, { data, error }) };
}

test("rechaza roles no logísticos antes de consultar la base", async () => {
  for (const role of ["warehouse_operator", "driver_operator"]) {
    const h = harness(role);
    await assert.rejects(h.call(), /Solo logística/);
    assert.equal(h.calls.length, 0);
  }
});

test("filtra empresa en todas las fuentes y despachos confirmados con fecha real", async () => {
  const h = harness(); await h.call();
  for (const [table, field] of [["distributors", "company_id"], ["dispatch_orders", "company_id"], ["order_pallets", "dispatch_orders.company_id"],
    ["order_pallets", "pallets.company_id"], ["order_pallets", "pallets.batches.products.company_id"]]) {
    assert.ok(h.calls.some((call) => call.table === table && call.method === "eq" && call.args[0] === field && call.args[1] === "company"), field);
  }
  assert.ok(h.calls.some((call) => call.table === "order_pallets" && call.method === "eq" && call.args[0] === "expected" && call.args[1] === true));
  assert.ok(h.calls.some((call) => call.table === "dispatch_orders" && call.method === "not" && call.args[0] === "confirmed_at"));
  assert.deepEqual(h.calls.find((call) => call.table === "dispatch_orders" && call.method === "in")!.args[1], ["confirmed", "delivered", "delivered_with_discrepancy"]);
});

test("pagina el historial completo más allá del límite de PostgREST", async () => {
  const h = harness();
  h.set("distributors", Array.from({ length: 501 }, (_, index) => ({ id: `c${index}`, name: `Cliente ${index}` })));
  const result = await h.call();
  assert.equal(result.forecasts.length, 501);
  assert.deepEqual(h.calls.filter((call) => call.table === "distributors" && call.method === "range").map((call) => call.args), [[0, 499], [500, 999]]);
});

test("mapea relaciones objeto/array y un error de base no parece historial vacío", async () => {
  const h = harness();
  h.set("distributors", [{ id: "c1", name: "Cliente" }]);
  h.set("dispatch_orders", [{ id: "o1", distributor_id: "c1", confirmed_at: "2026-01-01T15:00:00Z", status: "delivered" }]);
  h.set("order_pallets", [{ order_id: "o1", pallets: [{ quantity: 2.5, batches: [{ products: [{ id: "p1", name: "Arroz", sku: "ARR", unit_of_measure: "kilogramos" }] }] }] }]);
  const { forecasts } = await h.call();
  assert.equal(forecasts[0].products[0].averageQuantity, 2.5);
  assert.equal(forecasts[0].products[0].unit, "kilogramos");
  h.set("order_pallets", null, { message: "DB failure" });
  await assert.rejects(h.call(), /No se pudo consultar el historial/);
});
