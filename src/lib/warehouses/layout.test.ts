import { describe, expect, it } from "vitest";
import { canUseLayoutPreset, DEFAULT_LAYOUT, FLOOR_LAYOUT, parseWarehouseLayout } from "./layout";

describe("warehouse layouts", () => {
  it("provides the two ordered presets", () => {
    expect(DEFAULT_LAYOUT.map((x) => x.label)).toEqual(["Pasillo", "Estantería", "Nivel", "Posición"]);
    expect(FLOOR_LAYOUT.map((x) => x.label)).toEqual(["Sector", "Hilera", "Posición"]);
  });
  it("accepts one to four named levels and trims labels", () => {
    expect(parseWarehouseLayout([{ label: " Sector " }])).toEqual([{ label: "Sector" }]);
    expect(parseWarehouseLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });
  it.each([null, {}, [], [{ label: " " }], [{ label: 2 }], Array(5).fill({ label: "x" })])("rejects invalid layouts", (value) => {
    expect(parseWarehouseLayout(value)).toBeNull();
  });
  it("only allows presets with the same number of levels when locations exist", () => {
    expect(canUseLayoutPreset(1, 4, 3)).toBe(false);
    expect(canUseLayoutPreset(1, 3, 3)).toBe(true);
    expect(canUseLayoutPreset(0, 4, 3)).toBe(true);
  });
});
