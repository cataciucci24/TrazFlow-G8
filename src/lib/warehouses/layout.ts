export type WarehouseLayout = { label: string }[];

export const DEFAULT_LAYOUT: WarehouseLayout = ["Pasillo", "Estantería", "Nivel", "Posición"].map((label) => ({ label }));
export const FLOOR_LAYOUT: WarehouseLayout = ["Sector", "Hilera", "Posición"].map((label) => ({ label }));

export function canUseLayoutPreset(locationCount: number, currentLevels: number, presetLevels: number): boolean {
  return locationCount === 0 || currentLevels === presetLevels;
}

export function parseWarehouseLayout(value: unknown): WarehouseLayout | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  const result: WarehouseLayout = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.label !== "string" || !item.label.trim()) return null;
    result.push({ label: item.label.trim() });
  }
  return result;
}
