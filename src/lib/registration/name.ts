// Mantener el mismo límite (100 caracteres Unicode) en approve_access_request.
export const NAME_MAX_LENGTH = 100;

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && Array.from(name).length <= NAME_MAX_LENGTH ? name : null;
}
