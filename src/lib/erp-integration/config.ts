import "server-only";

import { DEFAULT_STALE_AFTER_HOURS } from "./status.ts";

const MAX_STALE_AFTER_HOURS = 24 * 365;

/**
 * Umbral de "desactualizado": horas desde la última sincronización exitosa. Variable de servidor
 * ERP_SYNC_STALE_AFTER_HOURS (24 por defecto, admite decimales). Un valor inválido usa el defecto.
 */
export function readStaleAfterHours(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ERP_SYNC_STALE_AFTER_HOURS?.trim();
  if (!raw) return DEFAULT_STALE_AFTER_HOURS;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 && hours <= MAX_STALE_AFTER_HOURS ? hours : DEFAULT_STALE_AFTER_HOURS;
}
