export function normalizeLocationCode(value: string): string {
  return value.trim().toUpperCase();
}
export function validLocationCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(value);
}
export function locationQr(id: string): string {
  return `TRZLOC:${id}`;
}
export function findScannedLocation<T extends { id: string; code: string }>(locations: T[], value: string): T | undefined {
  const code = value.trim();
  return locations.find((location) => locationQr(location.id) === code || location.code === normalizeLocationCode(code));
}
export function canLocatePallet(status: string): boolean {
  return status === "in_warehouse" || status === "assigned";
}
