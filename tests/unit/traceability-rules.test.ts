import { describe, expect, it } from "vitest";

import {
  canLocatePallet,
  findScannedLocation,
  locationQr,
  normalizeLocationCode,
  validLocationCode,
} from "../../src/lib/locations/rules.ts";

describe("reglas de trazabilidad", () => {
  it("normaliza y acepta un código de ubicación válido", () => {
    // Given: el operador ingresa un código con espacios y minúsculas.
    const scannedCode = " a-01_2 ";

    // When: el sistema normaliza y valida el código.
    const normalized = normalizeLocationCode(scannedCode);

    // Then: conserva un formato estable que puede guardarse y buscarse.
    expect(normalized).toBe("A-01_2");
    expect(validLocationCode(normalized)).toBe(true);
  });

  it("rechaza un QR de ubicación perteneciente a otra empresa", () => {
    // Given: la empresa actual solo conoce la ubicación A01.
    const companyLocations = [{ id: "own-id", code: "A01" }];

    // When: se escanea el QR de otra empresa.
    const location = findScannedLocation(companyLocations, locationQr("foreign-id"));

    // Then: no se identifica una ubicación válida.
    expect(location).toBeUndefined();
  });

  it("no permite reubicar un pallet que ya fue entregado", () => {
    // Given: el pallet ya completó su recorrido logístico.
    const palletStatus = "delivered";

    // When: el operador intenta seleccionar una ubicación.
    const canLocate = canLocatePallet(palletStatus);

    // Then: TrazFlow bloquea el movimiento físico inválido.
    expect(canLocate).toBe(false);
  });
});
