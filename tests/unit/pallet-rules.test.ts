import { describe, expect, it } from "vitest";

import { normalizePalletStatus } from "../../src/lib/pallets/status.ts";
import {
  allowsDecimals,
  isProductUnit,
  isValidQuantity,
  quantityStep,
} from "../../src/lib/pallets/units.ts";

describe("reglas de pallets", () => {
  it("convierte estados históricos al modelo actual", () => {
    expect(normalizePalletStatus("received")).toBe("delivered");
    expect(normalizePalletStatus("discrepancy")).toBe("delivery_discrepancy");
  });

  it("conserva los estados actuales", () => {
    expect(normalizePalletStatus("in_warehouse")).toBe("in_warehouse");
    expect(normalizePalletStatus("delivered")).toBe("delivered");
  });

  it("reconoce solamente las unidades permitidas", () => {
    expect(isProductUnit("unidades")).toBe(true);
    expect(isProductUnit("cajas")).toBe(true);
    expect(isProductUnit("kilogramos")).toBe(true);
    expect(isProductUnit("litros")).toBe(false);
  });

  it("permite decimales únicamente para kilogramos", () => {
    expect(allowsDecimals("kilogramos")).toBe(true);
    expect(allowsDecimals("cajas")).toBe(false);
    expect(allowsDecimals("unidades")).toBe(false);
  });

  it("exige cantidades enteras para cajas y unidades", () => {
    expect(isValidQuantity(12, "unidades")).toBe(true);
    expect(isValidQuantity(12.5, "unidades")).toBe(false);
    expect(isValidQuantity(3, "cajas")).toBe(true);
    expect(isValidQuantity(0.5, "cajas")).toBe(false);
  });

  it("admite hasta dos decimales para kilogramos", () => {
    expect(isValidQuantity(12.75, "kilogramos")).toBe(true);
    expect(isValidQuantity(12.755, "kilogramos")).toBe(false);
  });

  it("rechaza cantidades no positivas o no finitas", () => {
    expect(isValidQuantity(0, "kilogramos")).toBe(false);
    expect(isValidQuantity(-3, "unidades")).toBe(false);
    expect(isValidQuantity(Number.NaN, "unidades")).toBe(false);
    expect(isValidQuantity(Number.POSITIVE_INFINITY, "kilogramos")).toBe(false);
  });

  it("define el paso correcto para el campo de cantidad", () => {
    expect(quantityStep("cajas")).toBe("1");
    expect(quantityStep("kilogramos")).toBe("0.01");
    expect(quantityStep(null)).toBe("0.01");
  });
});
