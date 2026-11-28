export const LOCATION_COORDINATES = ["aisle", "rack", "level", "position"] as const;
export type LocationCoordinates = { aisle: string; rack: string | null; level: string | null; position: string | null };

/** Validate both missing and unexpected values against the current number of levels. */
export function parseLocationCoordinates(form: FormData, levelCount: number): LocationCoordinates | null {
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > 4) return null;
  const values = LOCATION_COORDINATES.map((name) => String(form.get(name) ?? "").trim());
  if (values.some((value, index) => index < levelCount ? !value || value.length > 40 : value.length > 0)) return null;
  return { aisle: values[0], rack: values[1] || null, level: values[2] || null, position: values[3] || null };
}
