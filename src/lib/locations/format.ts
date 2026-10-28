/**
 * Ubicación física de un pallet (TRZ-105), leída de `pallets.current_location_id` → `warehouse_locations`.
 * Sin dependencias de servidor: lo usan las queries y los componentes cliente.
 */
export type PalletLocation = {
  warehouseCode: string;
  code: string;
  aisle: string;
  rack: string;
  level: string;
  position: string;
};

export type RawPalletLocation = {
  warehouse_code: string;
  code: string;
  aisle: string;
  rack: string;
  level: string;
  position: string;
};

export const NO_LOCATION_LABEL = "Sin ubicación";

/**
 * Embed de Postgrest para leer la ubicación desde `pallets`. Va con el nombre del FK porque hay dos relaciones
 * entre pallets y warehouse_locations (la otra incluye warehouse_code) y sin él Postgrest responde PGRST201.
 * Para quien no ve `warehouse_locations` por RLS (policy `locations_select`), llega null.
 */
export const PALLET_LOCATION_EMBED =
  "location:warehouse_locations!pallets_company_location_fkey ( warehouse_code, code, aisle, rack, level, position )";

/** La relación hacia el lado "uno" puede llegar como objeto o como array según la versión del cliente. */
export function toPalletLocation(raw: RawPalletLocation | RawPalletLocation[] | null | undefined): PalletLocation | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row) return null;
  return {
    warehouseCode: row.warehouse_code,
    code: row.code,
    aisle: row.aisle,
    rack: row.rack,
    level: row.level,
    position: row.position,
  };
}

/** "DEP-01 / A01", el mismo texto que escribe `assign_pallet_location`, o "Sin ubicación". */
export function formatPalletLocation(location: PalletLocation | null | undefined): string {
  return location ? `${location.warehouseCode} / ${location.code}` : NO_LOCATION_LABEL;
}

// Orden natural: "2" antes que "10", sin distinguir mayúsculas.
const collator = new Intl.Collator("es-AR", { numeric: true, sensitivity: "base" });

/** Depósito → pasillo → estantería → nivel → posición (y código para desempatar). Sin ubicación, al final. */
export function comparePalletLocations(a: PalletLocation | null | undefined, b: PalletLocation | null | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  for (const key of ["warehouseCode", "aisle", "rack", "level", "position", "code"] as const) {
    const result = collator.compare(a[key], b[key]);
    if (result !== 0) return result;
  }
  return 0;
}

/** Copia ordenada por ubicación; los empates conservan el orden original. */
export function sortByLocation<T extends { location?: PalletLocation | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => comparePalletLocations(a.location, b.location));
}
