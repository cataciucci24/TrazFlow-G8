import { describe, expect, it } from "vitest";

import {
  canLocatePallet,
  findScannedLocation,
  locationQr,
  normalizeLocationCode,
  validLocationCode,
} from "../../src/lib/locations/rules.ts";

describe("reglas de trazabilidad", () => {
  it("normaliza un código con espacios y minúsculas", () => {
    // Given: el operador ingresa un código con espacios y minúsculas.
    const scannedCode = " a-01_2 ";

    // When: el sistema normaliza el código.
    const normalized = normalizeLocationCode(scannedCode);

    // Then: conserva un formato estable que puede guardarse y buscarse.
    expect(normalized).toBe("A-01_2");
  });

  it("acepta códigos de ubicación con formatos permitidos", () => {
    expect(validLocationCode("A")).toBe(true);
    expect(validLocationCode("P01-E02-N03")).toBe(true);
    expect(validLocationCode("DEPOSITO_01")).toBe(true);
  });

  it("rechaza códigos vacíos o con caracteres inválidos", () => {
    expect(validLocationCode("")).toBe(false);
    expect(validLocationCode("a01")).toBe(false);
    expect(validLocationCode("A 01")).toBe(false);
    expect(validLocationCode("-A01")).toBe(false);
    expect(validLocationCode("<script>")).toBe(false);
    expect(validLocationCode("A".repeat(41))).toBe(false);
  });

  it("genera un QR de ubicación con el prefijo de TrazFlow", () => {
    expect(locationQr("location-123")).toBe("TRZLOC:location-123");
  });

  it("encuentra una ubicación propia mediante su QR", () => {
    const companyLocations = [{ id: "own-id", code: "A01" }];

    const location = findScannedLocation(companyLocations, locationQr("own-id"));

    expect(location).toEqual(companyLocations[0]);
  });

  it("encuentra una ubicación mediante un código escrito manualmente", () => {
    const companyLocations = [{ id: "own-id", code: "A01" }];

    const location = findScannedLocation(companyLocations, " a01 ");

    expect(location).toEqual(companyLocations[0]);
  });

  it("rechaza un QR de ubicación perteneciente a otra empresa", () => {
    // Given: la empresa actual solo conoce la ubicación A01.
    const companyLocations = [{ id: "own-id", code: "A01" }];

    // When: se escanea el QR de otra empresa.
    const location = findScannedLocation(companyLocations, locationQr("foreign-id"));

    // Then: no se identifica una ubicación válida.
    expect(location).toBeUndefined();
  });

  it("no encuentra un código manual que no pertenece a la empresa", () => {
    const companyLocations = [{ id: "own-id", code: "A01" }];

    const location = findScannedLocation(companyLocations, "PAL-001");

    expect(location).toBeUndefined();
  });

  it("permite ubicar pallets que todavía están físicamente en el depósito", () => {
    expect(canLocatePallet("in_warehouse")).toBe(true);
    expect(canLocatePallet("assigned")).toBe(true);
  });

  it("bloquea la ubicación de pallets que ya salieron del depósito", () => {
    const blockedStatuses = ["in_transit", "delivered", "delivery_discrepancy", "received", "unknown"];

    for (const status of blockedStatuses) {
      expect(canLocatePallet(status)).toBe(false);
    }
  });
});
