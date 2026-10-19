import type { ProductUnit } from "../pallets/units.ts";

/**
 * Nombres de unidad del ERP (como los muestra ERPNext o el mock) → unidad de TrazFlow. Se comparan sin
 * mayúsculas, acentos ni punto final. Lo que no está acá no se adivina: el registro falla y queda auditado.
 */
const ERP_UNIT_ALIASES: Record<string, ProductUnit> = {
  unidad: "unidades",
  unidades: "unidades",
  un: "unidades",
  u: "unidades",
  unit: "unidades",
  units: "unidades",
  nos: "unidades",
  caja: "cajas",
  cajas: "cajas",
  cj: "cajas",
  box: "cajas",
  kg: "kilogramos",
  kgs: "kilogramos",
  kilo: "kilogramos",
  kilos: "kilogramos",
  kilogramo: "kilogramos",
  kilogramos: "kilogramos",
  kilogram: "kilogramos",
};

export function mapErpUnit(uom: string | null | undefined): ProductUnit | null {
  if (!uom) return null;
  const key = uom
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  return ERP_UNIT_ALIASES[key] ?? null;
}
