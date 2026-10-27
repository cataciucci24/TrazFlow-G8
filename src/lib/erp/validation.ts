import {
  ERP_CONTRACT_VERSION,
  ErpError,
  isDispatchDocumentState,
  type DispatchDocumentStatus,
  type DispatchReport,
  DELIVERY_DISCREPANCY_TYPES,
  DELIVERY_PALLET_OUTCOMES,
  DELIVERY_RECEIPT_CONTENT_TYPES,
  DELIVERY_RECEIPT_MAX_BYTES,
  type DeliveryReceipt,
  type DeliveryReport,
} from "./types.ts";

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

/** La clave de getDispatchStatus tiene que venir con contenido. */
export function assertValidIdempotencyKey(idempotencyKey: string): void {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw new ErpError("validation", "idempotencyKey es obligatoria para consultar el remito.");
  }
}

/** Respuesta de getDispatchStatus de cualquier proveedor: si no respeta el contrato, es invalid_response. */
export function assertValidDispatchDocumentStatus(value: unknown): asserts value is DispatchDocumentStatus {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const reference = record?.erpReference;
  if (!record || !isDispatchDocumentState(record.status) || (reference !== null && (typeof reference !== "string" || !reference.trim()))) {
    throw new ErpError("invalid_response", "El ERP respondió el estado del remito con un formato inesperado.");
  }
}

/* ---------- Entrega (TRZ-103) ---------- */

function commonDeliveryProblems(value: { contractVersion: unknown; idempotencyKey?: string; orderExternalId?: string; dispatchIdempotencyKey?: string }): string[] {
  const problems: string[] = [];
  if (value.contractVersion !== ERP_CONTRACT_VERSION) problems.push(`contractVersion ${String(value.contractVersion)} no soportada`);
  if (typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim()) problems.push("idempotencyKey es obligatoria");
  if (typeof value.orderExternalId !== "string" || !value.orderExternalId.trim()) problems.push("orderExternalId es obligatorio");
  if (typeof value.dispatchIdempotencyKey !== "string" || !value.dispatchIdempotencyKey.trim()) {
    problems.push("dispatchIdempotencyKey es obligatoria");
  }
  return problems;
}

/** Problemas de forma del reporte de entrega. Vacío = válido. */
export function deliveryReportProblems(report: DeliveryReport): string[] {
  const problems = commonDeliveryProblems(report);
  if (typeof report.deliveredAt !== "string" || Number.isNaN(Date.parse(report.deliveredAt))) problems.push("deliveredAt no es una fecha ISO 8601");
  if (typeof report.driver?.id !== "string" || !report.driver.id.trim()) problems.push("driver.id es obligatorio");
  if (typeof report.needsReview !== "boolean") problems.push("needsReview debe ser booleano");
  if (!Array.isArray(report.lines) || !report.lines.length) problems.push("la entrega no tiene pallets");
  if (!Array.isArray(report.discrepancies)) problems.push("discrepancies debe ser una lista");

  report.lines?.forEach?.((line, index) => {
    if (typeof line?.palletCode !== "string" || !line.palletCode.trim()) problems.push(`lines[${index}].palletCode es obligatorio`);
    if (!DELIVERY_PALLET_OUTCOMES.some((outcome) => outcome === line?.outcome)) problems.push(`lines[${index}].outcome inválido`);
  });
  report.discrepancies?.forEach?.((difference, index) => {
    if (!DELIVERY_DISCREPANCY_TYPES.some((type) => type === difference?.type)) problems.push(`discrepancies[${index}].type inválido`);
  });
  const hasDifferences = (report.discrepancies?.length ?? 0) > 0 || report.lines?.some?.((line) => line?.outcome !== "delivered");
  if (hasDifferences && report.needsReview !== true) problems.push("una entrega con diferencias tiene que quedar para revisión");
  return problems;
}

export function assertValidDeliveryReport(report: DeliveryReport): void {
  const problems = deliveryReportProblems(report);
  if (problems.length) throw new ErpError("validation", `Reporte de entrega inválido: ${problems.join("; ")}`);
}

/** Problemas de forma del remito firmado y su contenido. Vacío = válido. */
export function deliveryReceiptProblems(receipt: DeliveryReceipt, content?: Uint8Array): string[] {
  const problems = commonDeliveryProblems(receipt);
  if (typeof receipt.fileName !== "string" || !receipt.fileName.trim()) problems.push("fileName es obligatorio");
  if (!DELIVERY_RECEIPT_CONTENT_TYPES.some((type) => type === receipt.contentType)) problems.push("contentType no es una foto ni un PDF");
  if (!Number.isInteger(receipt.sizeBytes) || receipt.sizeBytes < 1 || receipt.sizeBytes > DELIVERY_RECEIPT_MAX_BYTES) {
    problems.push("sizeBytes fuera de rango (hasta 10 MB)");
  }
  if (typeof receipt.uploadedAt !== "string" || Number.isNaN(Date.parse(receipt.uploadedAt))) problems.push("uploadedAt no es una fecha ISO 8601");
  if (content !== undefined) {
    if (!(content instanceof Uint8Array) || content.byteLength === 0) problems.push("el archivo está vacío");
    else if (content.byteLength > DELIVERY_RECEIPT_MAX_BYTES) problems.push("el archivo supera los 10 MB");
  }
  return problems;
}

export function assertValidDeliveryReceipt(receipt: DeliveryReceipt, content: Uint8Array): void {
  const problems = deliveryReceiptProblems(receipt, content);
  if (problems.length) throw new ErpError("validation", `Remito de entrega inválido: ${problems.join("; ")}`);
}
