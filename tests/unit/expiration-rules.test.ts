import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPIRATION_THRESHOLDS,
  classifyExpiration,
  validateExpirationThresholds,
} from "../../src/lib/expiration/thresholds.ts";

describe("reglas de vencimiento", () => {
  it("clasifica como críticos los productos vencidos o próximos a vencer", () => {
    expect(classifyExpiration(-2, DEFAULT_EXPIRATION_THRESHOLDS)).toBe("critical");
    expect(classifyExpiration(30, DEFAULT_EXPIRATION_THRESHOLDS)).toBe("critical");
  });

  it("clasifica el nivel de precaución", () => {
    expect(classifyExpiration(31, DEFAULT_EXPIRATION_THRESHOLDS)).toBe("warning");
    expect(classifyExpiration(60, DEFAULT_EXPIRATION_THRESHOLDS)).toBe("warning");
  });

  it("clasifica el nivel próximo", () => {
    expect(classifyExpiration(61, DEFAULT_EXPIRATION_THRESHOLDS)).toBe("upcoming");
    expect(classifyExpiration(90, DEFAULT_EXPIRATION_THRESHOLDS)).toBe("upcoming");
  });

  it("no genera alertas fuera del último umbral", () => {
    expect(classifyExpiration(91, DEFAULT_EXPIRATION_THRESHOLDS)).toBeNull();
  });

  it("acepta umbrales enteros, crecientes y dentro del máximo", () => {
    expect(validateExpirationThresholds({ criticalDays: 15, cautionDays: 45, upcomingDays: 120 })).toBeNull();
  });

  it("rechaza días decimales o un nivel crítico menor a uno", () => {
    expect(validateExpirationThresholds({ criticalDays: 1.5, cautionDays: 45, upcomingDays: 90 })).toContain("enteros");
    expect(validateExpirationThresholds({ criticalDays: 0, cautionDays: 45, upcomingDays: 90 })).toContain("al menos 1");
  });

  it("rechaza umbrales desordenados o demasiado grandes", () => {
    expect(validateExpirationThresholds({ criticalDays: 30, cautionDays: 30, upcomingDays: 90 })).toContain("más días que crítico");
    expect(validateExpirationThresholds({ criticalDays: 30, cautionDays: 90, upcomingDays: 90 })).toContain("más días que precaución");
    expect(validateExpirationThresholds({ criticalDays: 30, cautionDays: 60, upcomingDays: 366 })).toContain("365 días");
  });
});
