import type { SubscriptionPlan } from "./types.ts";
export type PlanUsage = { operators: number; pallets: number; monthStart: string; palletsComplete: boolean };
export type PlanUsageResult = { available: true; usage: PlanUsage } | { available: false };
export function exceededPlanLimits(plan: SubscriptionPlan, usage: PlanUsage): string[] {
 const exceeded: string[] = [];
 if (plan.maxOperators !== null && usage.operators > plan.maxOperators)
  exceeded.push('Operadores activos: ' + usage.operators + '; límite: ' + plan.maxOperators + '.');
 if (plan.maxPalletsPerMonth !== null && usage.pallets > plan.maxPalletsPerMonth)
  exceeded.push('Pallets registrados en el mes: ' + (usage.palletsComplete ? '' : 'al menos ') + usage.pallets + '; límite: ' + plan.maxPalletsPerMonth + '.');
 return exceeded;
}
/** El catálogo llega ordenado por display_order; no inferir niveles por precio. */
export function isLowerPlan(plans: readonly SubscriptionPlan[], currentCode: string | null, selectedCode: string): boolean {
 const current = plans.findIndex((plan) => plan.code === currentCode);
 const selected = plans.findIndex((plan) => plan.code === selectedCode);
 return current >= 0 && selected >= 0 && selected < current;
}
