"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cancelSubscriptionMessages, type CancelSubscriptionState } from "./payments";

export async function cancelSubscription(_previous: CancelSubscriptionState, form: FormData): Promise<CancelSubscriptionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "No tenés permisos para cancelar la suscripción." };
  if (form.get("confirmed") !== "on") return { error: cancelSubscriptionMessages.confirmation_required };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_company_subscription", { p_confirmed: true });
    if (error) return { error: error.code === "42501" ? "No tenés permisos para cancelar la suscripción." : "No pudimos cancelar la suscripción. Podés reintentar." };
    if (data !== "canceled" && data !== "already_canceled") return { error: cancelSubscriptionMessages[String(data)] ?? "No pudimos cancelar la suscripción." };
  } catch {
    return { error: "No pudimos cancelar la suscripción. Podés reintentar." };
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/account?done=subscription-canceled");
}
