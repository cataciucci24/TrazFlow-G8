import { describe, expect, it } from "vitest";

import { dispatchReportProblems, assertValidDispatchReport } from "../../src/lib/erp/validation.ts";
import { ERP_CONTRACT_VERSION, ErpError, type DispatchReport } from "../../src/lib/erp/types.ts";

function validReport(overrides: Partial<DispatchReport> = {}): DispatchReport {
  return {
    contractVersion: ERP_CONTRACT_VERSION,
    idempotencyKey: "dispatch:ORDER-1",
    orderExternalId: "ORDER-1",
    dispatchedAt: "2026-10-25T12:00:00.000Z",
    operator: { id: "operator-1", name: "Operadora Demo" },
    lines: [{
      orderLineExternalId: "LINE-1",
      palletCode: "PAL-001",
      productExternalId: "PROD-1",
      lotExternalId: "LOT-1",
      quantity: 10,
      uom: "cajas",
    }],
    ...overrides,
  };
}

describe("validación de reportes de despacho al ERP", () => {
  it("acepta un reporte completo", () => {
    expect(dispatchReportProblems(validReport())).toEqual([]);
    expect(() => assertValidDispatchReport(validReport())).not.toThrow();
  });

  it("detecta datos obligatorios ausentes", () => {
    const report = validReport({ idempotencyKey: " ", orderExternalId: "", operator: { id: "", name: "Demo" } });
    const problems = dispatchReportProblems(report);
    expect(problems).toContain("idempotencyKey es obligatoria");
    expect(problems).toContain("orderExternalId es obligatorio");
    expect(problems).toContain("operator.id es obligatorio");
  });

  it("rechaza una versión de contrato no soportada y una fecha inválida", () => {
    const report = validReport({
      contractVersion: 99 as typeof ERP_CONTRACT_VERSION,
      dispatchedAt: "fecha-inválida",
    });
    expect(dispatchReportProblems(report)).toEqual(expect.arrayContaining([
      "contractVersion 99 no soportada",
      "dispatchedAt no es una fecha ISO 8601",
    ]));
  });

  it("rechaza un despacho sin pallets", () => {
    expect(dispatchReportProblems(validReport({ lines: [] }))).toContain("el despacho no tiene líneas");
  });

  it("detecta pallets repetidos", () => {
    const line = validReport().lines[0];
    const report = validReport({ lines: [line, { ...line }] });
    expect(dispatchReportProblems(report)).toContain("lines[1].palletCode PAL-001 está repetido");
  });

  it("detecta líneas incompletas o con cantidades inválidas", () => {
    const report = validReport({
      lines: [{
        orderLineExternalId: null,
        palletCode: "",
        productExternalId: "",
        lotExternalId: "",
        quantity: 0,
        uom: "",
      }],
    });
    expect(dispatchReportProblems(report)).toHaveLength(5);
  });

  it("lanza un error tipado cuando el reporte es inválido", () => {
    expect(() => assertValidDispatchReport(validReport({ lines: [] }))).toThrow(ErpError);
    expect(() => assertValidDispatchReport(validReport({ lines: [] }))).toThrow("Reporte de despacho inválido");
  });
});
