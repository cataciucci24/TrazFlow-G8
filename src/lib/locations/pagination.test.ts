import { describe, expect, it, vi } from "vitest";
import { readLocationPages } from "./pagination";
import { findScannedLocation, locationQr } from "./rules";

describe("lectura paginada de ubicaciones", () => {
  it.each([1000, 1001, 2000])("devuelve exactamente %i filas, sin duplicados ni omisiones", async (count) => {
    const source = Array.from({ length: count }, (_, index) => ({ id: index }));
    const query = vi.fn(async (from: number, to: number) => ({ data: source.slice(from, to + 1), error: null }));
    const result = await readLocationPages<{ id: number }>(query, "falló");
    expect(result).toEqual(source);
    expect(new Set(result.map((row) => row.id)).size).toBe(count);
    expect(query).toHaveBeenCalledWith(0, 499);
    expect(query).toHaveBeenCalledWith(1000, 1499);
  });
  it("no devuelve resultados parciales si una página falla", async () => {
    const error = new Error("fallo de red");
    const query = vi.fn(async (from: number) => from === 0 ? { data: Array(500).fill(1), error: null } : { data: null, error });
    await expect(readLocationPages(query, "No se pudo consultar")).rejects.toThrow("No se pudo consultar");
  });
  it("rechaza una respuesta sin datos aunque no informe error", async () => {
    await expect(readLocationPages(async () => ({ data: null, error: null }), "No se pudo consultar")).rejects.toThrow("No se pudo consultar");
  });
  it("encuentra por QR y código una ubicación posterior a la fila 1.000", async () => {
    const source = Array.from({ length: 1001 }, (_, index) => ({ id: `id-${index}`, code: `CODE-${index}` }));
    const rows = await readLocationPages<typeof source[number]>(async (from, to) => ({ data: source.slice(from, to + 1), error: null }), "falló");
    expect(findScannedLocation(rows, locationQr("id-1000"))).toEqual(source[1000]);
    expect(findScannedLocation(rows, "code-1000")).toEqual(source[1000]);
  });
});
