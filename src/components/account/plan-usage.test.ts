import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as Components from "./plan-usage";
import * as usage from "../../lib/plans/usage.ts";
import type { SubscriptionPlan } from "../../lib/plans/types.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = { exports: {} };
const source = ts.transpileModule(readFileSync(new URL("./plan-usage.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function("require", "module", "exports", source)((name: string) => {
 if (name === "@/lib/plans/usage") return usage;
 if (name.endsWith("design-system")) return { InlineAlert: ({ children }: { children?: ReactNode }) => createElement("aside", null, children) };
 return require(name);
}, compiled, compiled.exports);
const { UsageSummary, PlanLimitNotice } = compiled.exports as typeof Components;
const plan: SubscriptionPlan = { code: "starter", name: "Starter", currency: "USD", monthlyPriceCents: 6900, maxOperators: 3, maxPalletsPerMonth: 500, printerCount: 1, printerModel: "Zebra", equipmentPriceCents: 45000, preliminary: true };
const data: usage.PlanUsage = { operators: 4, pallets: 501, monthStart: "2026-10-01", palletsComplete: false };
test("avisos distinguen asignado, provisional e inferior; detallan ambos excesos", () => {
 for(const [context, label] of [["assigned", "plan asignado"], ["selected", "plan seleccionado provisionalmente"], ["lower", "plan inferior seleccionado"]] as const) {
  const html = renderToStaticMarkup(PlanLimitNotice({plan, usage: data, context}));
  assert.ok(html.includes(label));
  assert.match(html, /Operadores activos: 4/);
  assert.match(html, /al menos 501/);
 }
 assert.equal(PlanLimitNotice({ plan: {...plan, maxOperators: null, maxPalletsPerMonth: null}, usage: data, context: "selected" }), null);
});
test("fallos y mes incompleto son visibles sin afirmar que queda cupo", () => {
 assert.match(renderToStaticMarkup(UsageSummary({result: {available: false}})), /No pudimos consultar el consumo/);
 const html = renderToStaticMarkup(UsageSummary({result: {available: true, usage: data}}));
 assert.match(html, /puede estar incompleto/);
 assert.match(html, /no garantiza disponibilidad/);
 assert.doesNotMatch(renderToStaticMarkup(UsageSummary({result: {available: true, usage: {...data, palletsComplete: true}}})), /puede estar incompleto/);
});
