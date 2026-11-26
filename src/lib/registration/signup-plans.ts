import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SignupPlan } from "./company";

type Row = {
  code: string; name: string; monthly_price_cents: number; currency: string;
  max_operators: number | null; max_pallets_per_month: number | null; preliminary: boolean;
};

/** Planes que se pueden elegir al dar de alta la empresa. La RPC solo responde a quien todavía no tiene perfil. */
export async function getSignupPlans(): Promise<SignupPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_signup_plans");
  if (error) throw new Error("No se pudieron cargar los planes.", { cause: error });
  return ((data ?? []) as Row[]).map((row) => ({
    code: row.code, name: row.name, monthlyPriceCents: row.monthly_price_cents, currency: row.currency,
    maxOperators: row.max_operators, maxPalletsPerMonth: row.max_pallets_per_month, preliminary: row.preliminary,
  }));
}
