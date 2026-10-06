import { DEFAULT_EXPIRATION_THRESHOLDS } from "@/lib/expiration/thresholds";
import { createClient } from "@/lib/supabase/server";
import type { ExpirationThresholds } from "@/lib/types";

type RawThresholds = { critical_days: number; caution_days: number; upcoming_days: number };

/** Niveles de vencimiento de la empresa del usuario logueado. */
export async function getExpirationThresholds(): Promise<ExpirationThresholds> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_expiration_thresholds");

  if (error) {
    // Durante un despliegue la app puede llegar antes que la migración de TRZ-90.
    if (error.code === "PGRST202") return DEFAULT_EXPIRATION_THRESHOLDS;
    throw new Error(`No se pudieron leer los niveles de vencimiento (${error.code}: ${error.message}).`, { cause: error });
  }

  const row = ((data ?? []) as RawThresholds[])[0];
  if (!row) return DEFAULT_EXPIRATION_THRESHOLDS;
  return { criticalDays: row.critical_days, cautionDays: row.caution_days, upcomingDays: row.upcoming_days };
}
