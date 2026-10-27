/**
 * Vencimiento de los lotes del ERP (TRZ-64). Sin entorno ni red: seguro para componentes cliente.
 * Las fechas son días calendario (YYYY-MM-DD): se comparan como fechas, no como instantes, y "hoy" es la fecha
 * argentina, así un lote no cambia de estado por la hora del servidor (Vercel corre en UTC).
 */

export type ErpLotExpirationStatus = "expired" | "expiring" | "ok" | "none";

export type ErpLotExpiration = {
  status: ErpLotExpirationStatus;
  /** Días hasta el vencimiento (negativo si ya venció); null sin fecha. */
  days: number | null;
};

/** Por defecto "vence pronto" es a 30 días o menos (el nivel crítico de vencimientos de la empresa). */
export const DEFAULT_EXPIRING_DAYS = 30;

export function todayInArgentina(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now);
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

export function erpLotExpiration(
  expirationDate: string | null,
  today: string,
  expiringDays: number = DEFAULT_EXPIRING_DAYS,
): ErpLotExpiration {
  if (!expirationDate || Number.isNaN(Date.parse(expirationDate.slice(0, 10)))) return { status: "none", days: null };
  const days = dayNumber(expirationDate) - dayNumber(today);
  if (days < 0) return { status: "expired", days };
  if (days <= expiringDays) return { status: "expiring", days };
  return { status: "ok", days };
}

const STATUS_RANK: Record<ErpLotExpirationStatus, number> = { expired: 0, expiring: 1, ok: 2, none: 3 };

/** Primero los vencidos, después los que vencen pronto (el más cercano primero) y después el resto. */
export function sortByExpirationRisk<T extends { expirationDate: string | null }>(
  rows: T[],
  today: string,
  expiringDays: number = DEFAULT_EXPIRING_DAYS,
): T[] {
  return rows
    .map((row) => ({ row, expiration: erpLotExpiration(row.expirationDate, today, expiringDays) }))
    .sort((a, b) =>
      STATUS_RANK[a.expiration.status] - STATUS_RANK[b.expiration.status]
      || (a.expiration.days ?? Number.MAX_SAFE_INTEGER) - (b.expiration.days ?? Number.MAX_SAFE_INTEGER))
    .map(({ row }) => row);
}
