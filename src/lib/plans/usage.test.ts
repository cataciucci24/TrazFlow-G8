import assert from "node:assert/strict";
import test from "node:test";
import { exceededPlanLimits, isLowerPlan, type PlanUsage } from "./usage.ts";
import type { SubscriptionPlan } from "./types.ts";
const plan: SubscriptionPlan = { code: "starter", name: "Starter", monthlyPriceCents: 6900, currency: "USD", maxOperators: 3, maxPalletsPerMonth: 500, printerCount: 1, printerModel: "Zebra", equipmentPriceCents: 45000, preliminary: true };
const usage: PlanUsage = { operators: 3, pallets: 500, monthStart: "2026-10-01", palletsComplete: true };
test("igualar el límite no genera aviso; superar cada límite informa consumo y capacidad", () => {
 assert.deepEqual(exceededPlanLimits(plan, usage), []);
 assert.deepEqual(exceededPlanLimits(plan, { ...usage, operators: 4 }), ["Operadores activos: 4; límite: 3."]);
 assert.deepEqual(exceededPlanLimits(plan, { ...usage, pallets: 501 }), ["Pallets registrados en el mes: 501; límite: 500."]);
 assert.equal(exceededPlanLimits(plan, { ...usage, operators: 4, pallets: 501 }).length, 2);
});
test("los límites nulos son ilimitados y el consumo cero no genera aviso", () => {
 assert.deepEqual(exceededPlanLimits({ ...plan, maxOperators: null, maxPalletsPerMonth: null }, { ...usage, operators: 9999, pallets: 99999 }), []);
 assert.deepEqual(exceededPlanLimits(plan, { ...usage, operators: 0, pallets: 0 }), []);
 assert.equal(exceededPlanLimits({ ...plan, maxOperators: null }, { ...usage, operators: 9999, pallets: 501 }).length, 1);
});
test("consumo incompleto es mínimo conocido, nunca total reconstruido", () => {
 assert.match(exceededPlanLimits(plan, { ...usage, pallets: 501, palletsComplete: false })[0], /al menos 501/);
});
test("plan inferior usa orden del catálogo incluso saltando niveles, sin precios ni códigos fijos", () => {
 const plans = [plan, { ...plan, code: "growth" }, { ...plan, code: "enterprise", monthlyPriceCents: null }];
 assert.equal(isLowerPlan(plans, "enterprise", "starter"), true);
 assert.equal(isLowerPlan(plans, "starter", "enterprise"), false);
 assert.equal(isLowerPlan(plans, "starter", "starter"), false);
 assert.equal(isLowerPlan(plans, null, "starter"), false);
 assert.equal(isLowerPlan(plans, "missing", "starter"), false);
 assert.equal(isLowerPlan(plans, "enterprise", "missing"), false);
});
