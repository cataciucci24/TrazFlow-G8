"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parsePlanChange, planChangeMessages, type PlanChangeState } from "./change";

export async function changeCompanyPlan(_previous: PlanChangeState, form: FormData): Promise<PlanChangeState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "No tenés permisos para cambiar el plan." };
  const args = parsePlanChange(form);
  if (!args) return { error: planChangeMessages.confirmation_required };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("change_company_plan", args);
    if (error) return { error: error.code === "42501" ? "No tenés permisos para cambiar el plan." : "No pudimos confirmar el cambio. Podés reintentar la misma solicitud." };
    if (data !== "changed" && data !== "already_applied") return { error: planChangeMessages[String(data)] ?? "No pudimos confirmar el cambio." };
  } catch {
    return { error: "No pudimos confirmar el cambio. Podés reintentar la misma solicitud." };
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/account?done=plan-changed");
}
