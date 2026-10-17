import { ERP_CONTRACT_VERSION, ErpError, type DispatchReport } from "./types.ts";

/** Problemas de forma del reporte, antes de enviarlo a cualquier proveedor. Vacío = válido. */
export function dispatchReportProblems(report: DispatchReport): string[] {
  const problems: string[] = [];

  if (report.contractVersion !== ERP_CONTRACT_VERSION) {
    problems.push(`contractVersion ${String(report.contractVersion)} no soportada`);
  }
  if (!report.idempotencyKey?.trim()) problems.push("idempotencyKey es obligatoria");
  if (!report.orderExternalId?.trim()) problems.push("orderExternalId es obligatorio");
  if (Number.isNaN(Date.parse(report.dispatchedAt))) problems.push("dispatchedAt no es una fecha ISO 8601");
  if (!report.operator?.id?.trim()) problems.push("operator.id es obligatorio");
  if (!report.lines?.length) problems.push("el despacho no tiene líneas");

  const pallets = new Set<string>();
  report.lines?.forEach((line, index) => {
    const at = `lines[${index}]`;
    if (!line.palletCode?.trim()) problems.push(`${at}.palletCode es obligatorio`);
    else if (pallets.has(line.palletCode)) problems.push(`${at}.palletCode ${line.palletCode} está repetido`);
    else pallets.add(line.palletCode);
    if (!line.productExternalId?.trim()) problems.push(`${at}.productExternalId es obligatorio`);
    if (!line.lotExternalId?.trim()) problems.push(`${at}.lotExternalId es obligatorio`);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) problems.push(`${at}.quantity debe ser mayor a cero`);
    if (!line.uom?.trim()) problems.push(`${at}.uom es obligatoria`);
  });

  return problems;
}

export function assertValidDispatchReport(report: DispatchReport): void {
  const problems = dispatchReportProblems(report);
  if (problems.length) throw new ErpError("validation", `Reporte de despacho inválido: ${problems.join("; ")}`);
}
