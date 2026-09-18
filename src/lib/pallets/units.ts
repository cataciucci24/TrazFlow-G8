export const PALLET_UNITS = ["unidades", "cajas", "kilogramos"] as const;

export type PalletUnit = (typeof PALLET_UNITS)[number];

export function isPalletUnit(value: string): value is PalletUnit {
  return PALLET_UNITS.some((unit) => unit === value);
}
