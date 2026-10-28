import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type * as Queries from "./queries";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function harness(result: { data: unknown; error: unknown }, throws = false) {
  const filters: [string, unknown][] = [];
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
    maybeSingle: async () => { if (throws) throw new Error("network"); return result; },
    order: async () => { if (throws) throw new Error("network"); return result; },
  };
  const source = ts.transpileModule(readFileSync(new URL("./queries.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", source)((name: string) => {
    if (name === "server-only") return {};
    if (name === "react") return { cache: (fn: unknown) => fn };
    if (name === "@/lib/supabase/server") return { createClient: async () => ({ from: () => builder }) };
    throw new Error(`Unexpected import: ${name}`);
  }, compiled, compiled.exports);
  return { api: compiled.exports as typeof Queries, filters };
}

test("sin asignación se informa sin plan, filtrando siempre por la empresa de la sesión", async () => {
  const { api, filters } = harness({ data: null, error: null });
  assert.deepEqual(await api.getCompanyPlan("company-a"), { available: true, plan: null });
  assert.deepEqual(filters, [["company_id", "company-a"]]);
});

test("un error de lectura nunca se presenta como empresa sin plan", async () => {
  for (const throws of [false, true]) {
    const { api } = harness({ data: null, error: { code: "PGRST205" } }, throws);
    assert.deepEqual(await api.getCompanyPlan("company-a"), { available: false, plan: null });
    assert.deepEqual(await api.getPlanCatalog(), { available: false, plans: [] });
  }
});

test("una asignación cuyo plan no se puede leer se informa como no disponible", async () => {
  const { api } = harness({ data: { subscription_plans: null }, error: null });
  assert.deepEqual(await api.getCompanyPlan("company-a"), { available: false, plan: null });
});

test("el plan actual y el catálogo usan los valores persistidos, incluyendo precios y límites nulos", async () => {
  const row = { code: "enterprise", name: "Enterprise", monthly_price_cents: null, currency: "USD", max_operators: null, max_pallets_per_month: null, printer_count: null, printer_model: "Zebra ZQ320", equipment_price_cents: null, preliminary: true };
  const expected = { code: "enterprise", name: "Enterprise", monthlyPriceCents: null, currency: "USD", maxOperators: null, maxPalletsPerMonth: null, printerCount: null, printerModel: "Zebra ZQ320", equipmentPriceCents: null, preliminary: true };
  for (const relation of [row, [row]]) {
    const { api } = harness({ data: { subscription_plans: relation }, error: null });
    assert.deepEqual(await api.getCompanyPlan("company-a"), { available: true, plan: expected });
  }
  const { api } = harness({ data: [row], error: null });
  assert.deepEqual(await api.getPlanCatalog(), { available: true, plans: [expected] });
});
