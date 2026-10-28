import { describe, expect, it } from "vitest";

import { NAME_MAX_LENGTH, normalizeName } from "../../src/lib/registration/name.ts";

describe("normalización del nombre de registro", () => {
  it("quita espacios al comienzo y al final", () => {
    expect(normalizeName("  Ana Pérez  ")).toBe("Ana Pérez");
  });

  it("conserva nombres con caracteres Unicode", () => {
    expect(normalizeName("Ámbar 🚚")).toBe("Ámbar 🚚");
  });

  it("rechaza textos vacíos", () => {
    expect(normalizeName("   ")).toBeNull();
  });

  it("rechaza valores que no son texto", () => {
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName(123)).toBeNull();
  });

  it("acepta el límite y rechaza nombres demasiado largos", () => {
    expect(normalizeName("A".repeat(NAME_MAX_LENGTH))).toHaveLength(NAME_MAX_LENGTH);
    expect(normalizeName("A".repeat(NAME_MAX_LENGTH + 1))).toBeNull();
  });
});
