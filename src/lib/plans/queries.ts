import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CompanyPlanResult, SubscriptionPlan } from "@/lib/plans/types";

type PlanRow = {
  code: string; name: string; monthly_price_cents: number | null; currency: string;
  max_operators: number | null; max_pallets_per_month: number | null;
  printer_count: number | null; printer_model: string; equipment_price_cents: number | null;
  preliminary: boolean;
};

const PLAN_SELECT = "code, name, monthly_price_cents, currency, max_operators, max_pallets_per_month, printer_count, printer_model, equipment_price_cents, preliminary";

function toPlan(row: PlanRow): SubscriptionPlan {
  return {
    code: row.code, name: row.name, monthlyPriceCents: row.monthly_price_cents, currency: row.currency,
    maxOperators: row.max_operators, maxPalletsPerMonth: row.max_pallets_per_month,
    printerCount: row.printer_count, printerModel: row.printer_model,
    equipmentPriceCents: row.equipment_price_cents, preliminary: row.preliminary,
  };
}

/** RLS restricts reads to active logistics managers. No company gets a default plan. */
export const getCompanyPlan = cache(async (companyId: string): Promise<CompanyPlanResult> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("company_plans")
      .select(`assigned_at, subscription_plans (${PLAN_SELECT})`).eq("company_id", companyId).maybeSingle();
    if (error) return { available: false, plan: null };
    const relation = data?.subscription_plans as unknown as PlanRow | PlanRow[] | null;
    const row = Array.isArray(relation) ? relation[0] : relation;
    // A hidden/missing related plan is an unavailable record, not an unassigned company.
    if (data && !row) return { available: false, plan: null };
    return { available: true, plan: row ? toPlan(row) : null, ...(typeof data?.assigned_at === "string" ? { assignedAt: data.assigned_at } : {}) };
  } catch {
    // A billing/catalog outage must not take down the operational sidebar.
    return { available: false, plan: null };
  }
});

export const getPlanCatalog = cache(async (): Promise<{ available: boolean; plans: SubscriptionPlan[] }> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("subscription_plans")
      .select(PLAN_SELECT).order("display_order");
    if (error) return { available: false, plans: [] };
    return { available: true, plans: ((data ?? []) as PlanRow[]).map(toPlan) };
  } catch {
    return { available: false, plans: [] };
  }
});
