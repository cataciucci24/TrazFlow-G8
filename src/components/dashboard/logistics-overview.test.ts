import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExpirationAlert, DistributorStockAlert, UserRole } from "../../lib/types";
import type { StockAlertsResult } from "../../lib/stock-alerts/queries";
import type * as OverviewModule from "./logistics-overview";
import type * as PageModule from "../../app/dashboard/page";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../../", import.meta.url));
const expiration: ExpirationAlert = {
  palletId: "p1", productName: "Producto próximo", productSku: "SKU-1", batchNumber: "LOTE / 1",
  quantity: 20, unitOfMeasure: "cajas", currentLocation: "Depósito central",
  expirationDate: "2026-12-01", daysRemaining: 60, urgency: "warning",
};
const stock: DistributorStockAlert = {
  id: "s1", distributorName: "Distribuidora central", productName: "Producto crítico", productSku: "SKU-2",
  currentStock: 10, dailyConsumption: 5, unitOfMeasure: "cajas", stockDays: 2, riskLevel: "critical",
};

/** Render the real presentation with isolated data sources; never contact Supabase. */
function harness(role: UserRole = "logistics_manager", stockData: StockAlertsResult = { alerts: [stock], inventorySourceAvailable: true }) {
  const calls: { name: string; args: unknown[] }[] = [];
  const cache = new Map<string, { exports: unknown }>();
  const query = {
    select: (...args: unknown[]) => { calls.push({ name: "select", args }); return query; },
    order: (...args: unknown[]) => { calls.push({ name: "order", args }); return query; },
    eq: (...args: unknown[]) => { calls.push({ name: "eq", args }); return query; },
    in: (...args: unknown[]) => { calls.push({ name: "in", args }); return query; },
    data: [{ id: "order-1", status: role === "warehouse_operator" ? "draft" : "confirmed", distributors: { name: "Destino" }, order_pallets: [{ validated_at: null }] }],
  };
  function load(file: string): unknown {
    if (cache.has(file)) return cache.get(file)!.exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", code)((name: string) => {
      if (name === "@/lib/auth/session") return {
        requireUserProfile: async () => ({ role, companyId: "company-1" }),
        hasRole: (profile: { role: UserRole }, ...roles: UserRole[]) => roles.includes(profile.role),
      };
      if (name === "@/lib/pallets/queries") return { getExpirationAlerts: async (...args: unknown[]) => { calls.push({ name: "expiration", args }); return [expiration]; } };
      if (name === "@/lib/stock-alerts/queries") return { getDistributorStockAlerts: async (...args: unknown[]) => { calls.push({ name: "stock", args }); return stockData; } };
      if (name === "@/lib/supabase/server") return { createClient: async () => ({ from: (...args: unknown[]) => { calls.push({ name: "from", args }); return query; } }) };
      if (name === "next/link") return function TestLink({ children, href, ...props }: { children: ReactNode; href: string }) { return createElement("a", { ...props, href }, children); };
      if (name === "next/form") return function TestForm({ children, ...props }: { children: ReactNode }) { return createElement("form", props, children); };
      if (name.startsWith("@/")) {
        const base = resolve(root, name.slice(2));
        const target = [".tsx", ".ts"].map((extension) => base + extension).find(existsSync);
        assert.ok(target, `Module exists: ${name}`);
        return load(target);
      }
      return require(name);
    }, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  const overview = load(resolve(root, "components/dashboard/logistics-overview.tsx")) as typeof OverviewModule;
  const page = load(resolve(root, "app/dashboard/page.tsx")) as typeof PageModule;
  return { overview, page, calls };
}

function render(expirationAlerts: ExpirationAlert[], stockData: StockAlertsResult) {
  const { overview } = harness();
  return renderToStaticMarkup(createElement(overview.LogisticsOverview, { expirationAlerts, stockData }));
}

test("prioriza alertas críticas y limita el resumen a cinco sin perder los totales", () => {
  const html = render(Array.from({ length: 6 }, (_, index) => ({ ...expiration, palletId: `p-${index}`, productName: `Próximo ${index}` })), { alerts: [stock], inventorySourceAvailable: true });
  assert.ok(html.indexOf("Producto crítico") < html.indexOf("Próximo 0"));
  assert.equal((html.match(/<li /g) ?? []).length, 5);
  assert.match(html, /Mostrando 5 de 7 alertas/);
  assert.match(html, /6 de precaución/);
  assert.match(html, /view=lotes&amp;lote=LOTE%20%2F%201/);
});

test("distingue ausencia de alertas de una fuente de stock no disponible", () => {
  const empty = render([], { alerts: [], inventorySourceAvailable: true });
  assert.match(empty, /Sin alertas activas de stock o vencimiento/);
  assert.doesNotMatch(empty, /Fuente no disponible/);
  const partial = render([], { alerts: [], inventorySourceAvailable: false });
  assert.match(partial, /Fuente no disponible/);
  assert.match(partial, /Sin alertas de vencimiento disponibles/);
  assert.doesNotMatch(partial, /Sin alertas activas de stock o vencimiento/);
  assert.match(partial, /class="summary-value">—</);
});

test("mantiene destinos existentes y la consulta de trazabilidad por QR", () => {
  const html = render([], { alerts: [], inventorySourceAvailable: true });
  for (const route of ["orders", "pallets", "inventory", "lots", "stagnant", "alerts"]) assert.match(html, new RegExp(`href="/dashboard/${route}"`));
  assert.match(html, /action="\/dashboard\/traceability"/);
  assert.match(html, /name="qr"/);
  assert.doesNotMatch(html, /\/dashboard\/stock-report/);
  assert.ok(html.indexOf("Resumen operativo") < html.indexOf("Atención requerida"));
  assert.ok(html.indexOf("Atención requerida") < html.indexOf("Continuar la operación"));
});

test("logística utiliza exclusivamente las dos consultas originales con la misma empresa", async () => {
  const { page, calls } = harness();
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ created: "1" }) }));
  assert.match(html, /Centro de control/);
  assert.match(html, /Orden de despacho creada correctamente/);
  assert.deepEqual(calls, [{ name: "expiration", args: ["company-1"] }, { name: "stock", args: ["company-1"] }]);
});

for (const role of ["warehouse_operator", "distributor_operator"] as const) {
  test(`${role} conserva su consulta operativa y no recibe el centro logístico`, async () => {
    const { page, calls } = harness(role);
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ created: "1" }) }));
    assert.match(html, role === "warehouse_operator" ? /Confirmar despacho/ : /Confirmar recepción/);
    assert.match(html, /href="\/dashboard\/orders\/order-1"/);
    assert.doesNotMatch(html, /Resumen operativo|Continuar la operación|Orden de despacho creada correctamente/);
    assert.equal(calls.filter((call) => call.name === "from").length, 1);
    assert.equal(calls.filter((call) => call.name === "expiration" || call.name === "stock").length, 0);
    assert.ok(calls.some((call) => call.name === "eq" && call.args[0] === (role === "warehouse_operator" ? "company_id" : "status") && call.args[1] === (role === "warehouse_operator" ? "company-1" : "confirmed")));
  });
}
