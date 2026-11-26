// Mismo algoritmo que public.is_valid_cuit (migración 20261126100000_trz112_company_onboarding.sql).
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const PREFIXES = new Set(["20", "23", "24", "27", "30", "33", "34"]);

/** 11 dígitos con prefijo conocido y dígito verificador correcto (módulo 11). */
export function isValidCuitDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || !PREFIXES.has(digits.slice(0, 2))) return false;
  const total = WEIGHTS.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0);
  let check = 11 - (total % 11);
  if (check === 11) check = 0;
  // Un resto que da 10 no es válido (AFIP cambia el prefijo a 23/33 en ese caso).
  return check < 10 && check === Number(digits[10]);
}

/**
 * Acepta el CUIT con o sin guiones, puntos o espacios y lo devuelve como "30-71234567-1".
 * Devuelve null si no es un CUIT válido.
 */
export function normalizeCuit(value: unknown): string | null {
  if (typeof value !== "string" || !/^[\d .-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (!isValidCuitDigits(digits)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
