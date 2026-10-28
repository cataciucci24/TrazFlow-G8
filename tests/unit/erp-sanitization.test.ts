import { describe, expect, it } from "vitest";

import { sanitizeErpErrorText } from "../../src/lib/erp-integration/sanitize.ts";

describe("seguridad de mensajes del ERP", () => {
  it("conserva un mensaje que no contiene información sensible", () => {
    expect(sanitizeErpErrorText("El ERP no respondió a tiempo.")).toBe("El ERP no respondió a tiempo.");
  });

  it("oculta direcciones públicas y privadas", () => {
    const value = "Falló https://erp.interno.local/api y http://10.0.0.5/recurso";
    expect(sanitizeErpErrorText(value)).toBe("Falló [url oculta] y [url oculta]");
  });

  it("oculta encabezados y tokens de autenticación", () => {
    expect(sanitizeErpErrorText("Authorization: token abc:def rechazado")).toBe("Authorization [oculto] rechazado");
    expect(sanitizeErpErrorText("Bearer token-super-secreto")).toBe("Bearer [oculto]");
  });

  it("oculta claves, contraseñas y correos", () => {
    const value = "api_key=ABC password=hunter2 usuario ops@empresa.com";
    expect(sanitizeErpErrorText(value)).toBe("api_key=[oculto] password=[oculto] usuario [correo oculto]");
  });

  it("elimina caracteres de control y espacios repetidos", () => {
    expect(sanitizeErpErrorText("  línea 1\nlínea\t2\u0000  ")).toBe("línea 1 línea 2");
  });

  it("trunca mensajes excesivamente largos", () => {
    const result = sanitizeErpErrorText("palabra ".repeat(100));
    expect(result).toHaveLength(300);
    expect(result?.endsWith("…")).toBe(true);
  });

  it("devuelve null para valores vacíos o que no son texto", () => {
    expect(sanitizeErpErrorText(null)).toBeNull();
    expect(sanitizeErpErrorText(42)).toBeNull();
    expect(sanitizeErpErrorText("   ")).toBeNull();
  });
});
