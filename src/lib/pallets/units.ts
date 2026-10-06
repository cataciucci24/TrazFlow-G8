/** Unidad base de un producto (products.unit_of_measure). Vale para sus pallets y para el stock de las distribuidoras. */
export const PRODUCT_UNITS = ["unidades", "cajas", "kilogramos"] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export function isProductUnit(value: string): value is ProductUnit {
  return PRODUCT_UNITS.some((unit) => unit === value);
}

/** "kilogramos" es el caso de peso variable: admite hasta dos decimales. Las demás unidades, solo enteros. */
export function allowsDecimals(unit: ProductUnit): boolean {
  return unit === "kilogramos";
}

/** Misma regla que save_distributor_stock: mayor a cero y entera salvo en kilogramos (hasta dos decimales). */
export function isValidQuantity(quantity: number, unit: ProductUnit): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (!allowsDecimals(unit)) return Number.isInteger(quantity);
  return Math.abs(quantity * 100 - Math.round(quantity * 100)) < 1e-9;
}

/** Paso del input numérico de cantidad según la unidad. */
export function quantityStep(unit: ProductUnit | null): string {
  return unit === null || allowsDecimals(unit) ? "0.01" : "1";
}
