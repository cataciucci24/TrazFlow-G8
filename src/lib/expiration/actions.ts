"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { validateExpirationThresholds } from "@/lib/expiration/thresholds";
import { createClient } from "@/lib/supabase/server";

export type SaveExpirationThresholdsState = { error: string | null; success: string | null };

export async function saveExpirationThresholds(
  _previousState: SaveExpirationThresholdsState,
  formData: FormData,
): Promise<SaveExpirationThresholdsState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "No tenés permisos para cambiar los criterios de alerta.", success: null };
  }

  const thresholds = {
    criticalDays: Number(formData.get("criticalDays")),
    cautionDays: Number(formData.get("cautionDays")),
    upcomingDays: Number(formData.get("upcomingDays")),
  };
  const invalid = validateExpirationThresholds(thresholds);
  if (invalid) return { error: invalid, success: null };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_expiration_thresholds", {
    p_critical_days: thresholds.criticalDays,
    p_caution_days: thresholds.cautionDays,
    p_upcoming_days: thresholds.upcomingDays,
  });
  if (error) {
    console.error("Error en set_expiration_thresholds", { code: error.code });
    return { error: error.code === "P3901" ? "Los criterios no son válidos. Revisá los días." : "No se pudieron guardar los criterios. Intentá nuevamente.", success: null };
  }

  revalidatePath("/dashboard", "layout");
  return { error: null, success: "Criterios de alerta actualizados." };
}
