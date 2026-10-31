import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PlanUsageResult } from "./usage";
export const getCompanyPlanUsage = cache(async (): Promise<PlanUsageResult> => {
 try {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_plan_usage");
  const row = data?.[0];
  if (error || !row || !Number.isSafeInteger(row.operators) || row.operators < 0
   || !Number.isSafeInteger(row.pallets) || row.pallets < 0
   || typeof row.month_start !== "string" || typeof row.pallets_complete !== "boolean") return { available: false };
  return { available: true, usage: { operators: row.operators, pallets: row.pallets,
   monthStart: row.month_start, palletsComplete: row.pallets_complete } };
 } catch { return { available: false }; }
});
