import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** Un secreto más corto no se acepta: el endpoint queda cerrado como si no estuviera configurado. */
export const MIN_CRON_SECRET_LENGTH = 16;

/**
 * ¿El header Authorization es `Bearer ${CRON_SECRET}`? Sin secreto configurado (o demasiado corto) rechaza
 * siempre: nunca abierto por defecto. La comparación es en tiempo constante: se comparan los hashes, que
 * tienen el mismo largo aunque el header no.
 */
export function isCronAuthorized(authorization: string | null | undefined, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (!expected || expected.length < MIN_CRON_SECRET_LENGTH || !authorization) return false;
  const received = createHash("sha256").update(authorization).digest();
  const wanted = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(received, wanted);
}
