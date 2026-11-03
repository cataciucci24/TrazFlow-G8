import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_SELECT, toPayment, type CompanyPayment, type PaymentRow, type SubscriptionAccess } from "./payments.ts";

/** RLS restringe la lectura a logística activa de la propia empresa. */
export const getCompanyPayments = cache(async (companyId: string): Promise<{ available: boolean; payments: CompanyPayment[] }> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("company_payments").select(PAYMENT_SELECT)
      .eq("company_id", companyId).order("payment_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) return { available: false, payments: [] };
    return { available: true, payments: ((data ?? []) as PaymentRow[]).map(toPayment) };
  } catch {
    return { available: false, payments: [] };
  }
});

export async function getCompanyPayment(companyId: string, paymentId: string): Promise<CompanyPayment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_payments").select(PAYMENT_SELECT)
    .eq("company_id", companyId).eq("id", paymentId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el pago (${error.code}).`, { cause: error });
  return data ? toPayment(data as PaymentRow) : null;
}

/** Una falla de esta lectura nunca debe cortarle la operación a una empresa: no bloquea. */
export const getSubscriptionAccess = cache(async (): Promise<SubscriptionAccess> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_company_subscription_access");
    if (error) return { available: false, canceledAt: null, accessUntil: null, ended: false };
    const row = data?.[0];
    return { available: true, canceledAt: row?.canceled_at ?? null, accessUntil: row?.access_until ?? null, ended: row?.ended === true };
  } catch {
    return { available: false, canceledAt: null, accessUntil: null, ended: false };
  }
});
