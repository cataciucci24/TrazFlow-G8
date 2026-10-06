import type { ExpirationThresholds } from "@/lib/types";

/** Valores de la migración: se usan si la empresa todavía no los cambió o la lectura falla. */
export const DEFAULT_EXPIRATION_THRESHOLDS: ExpirationThresholds = { criticalDays: 30, cautionDays: 60, upcomingDays: 90 };

export const MAX_EXPIRATION_DAYS = 365;

export type ExpirationLevel = "critical" | "warning" | "upcoming";

/** Nivel de alerta según los días al vencimiento; null si queda fuera del último nivel. */
export function classifyExpiration(daysRemaining: number, thresholds: ExpirationThresholds): ExpirationLevel | null {
  if (daysRemaining <= thresholds.criticalDays) return "critical";
  if (daysRemaining <= thresholds.cautionDays) return "warning";
  if (daysRemaining <= thresholds.upcomingDays) return "upcoming";
  return null;
}

/** Mismas reglas que set_expiration_thresholds; devuelve el error a mostrar o null. */
export function validateExpirationThresholds({ criticalDays, cautionDays, upcomingDays }: ExpirationThresholds): string | null {
  if (![criticalDays, cautionDays, upcomingDays].every(Number.isInteger)) return "Los días deben ser números enteros.";
  if (criticalDays < 1) return "El nivel crítico debe ser de al menos 1 día.";
  if (criticalDays >= cautionDays) return "Precaución debe tener más días que crítico.";
  if (cautionDays >= upcomingDays) return "Próximo debe tener más días que precaución.";
  if (upcomingDays > MAX_EXPIRATION_DAYS) return `Próximo no puede superar los ${MAX_EXPIRATION_DAYS} días.`;
  return null;
}
