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
  type ErpWarehouse,
  type PalletScanReport,
  type StockEntryReport,
  type StockImportReport,
  STOCK_ENTRY_TYPES,
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

/**
 * Forma de `ErpMasterData.warehouses` (TRZ-101). Vacío = válido. Solo la forma: un externalId repetido o vacío
 * se audita por registro en la sincronización (erp_sync_apply_warehouses), igual que productos y lotes.
 */
export function erpWarehousesProblems(warehouses: unknown): string[] {
  if (!Array.isArray(warehouses)) return ["warehouses no es una lista"];
  const problems: string[] = [];
  warehouses.forEach((warehouse: Partial<Record<keyof ErpWarehouse, unknown>> | null, index) => {
    const at = `warehouses[${index}]`;
    if (!warehouse || typeof warehouse !== "object") {
      problems.push(`${at} no es un objeto`);
      return;
    }
    if (typeof warehouse.externalId !== "string") problems.push(`${at}.externalId no es texto`);
    if (typeof warehouse.name !== "string") problems.push(`${at}.name no es texto`);
    if (typeof warehouse.active !== "boolean") problems.push(`${at}.active no es booleano`);
    if (typeof warehouse.updatedAt !== "string" || Number.isNaN(Date.parse(warehouse.updatedAt))) {
      problems.push(`${at}.updatedAt no es una fecha ISO 8601`);
    }
  });
  return problems;
}

/** Los depósitos de cualquier proveedor: si no respetan el contrato, es invalid_response. */
export function assertValidErpWarehouses(warehouses: unknown): asserts warehouses is ErpWarehouse[] {
  const problems = erpWarehousesProblems(warehouses);
  if (problems.length) {
    throw new ErpError("invalid_response", `El ERP respondió los depósitos con un formato inesperado: ${problems.slice(0, 3).join("; ")}.`);
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

/* ---------- Movimientos de stock (TRZ-62) y escaneos (TRZ-63) ---------- */

function text(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function stockEntryReportProblems(entry: StockEntryReport): string[] {
  const problems: string[] = [];
  if (entry.contractVersion !== ERP_CONTRACT_VERSION) problems.push(`contractVersion ${String(entry.contractVersion)} no soportada`);
  if (!text(entry.idempotencyKey) || !entry.idempotencyKey.startsWith("stock-entry:")) problems.push("idempotencyKey inválida");
  if (!STOCK_ENTRY_TYPES.some((type) => type === entry.entryType)) problems.push("entryType inválido");
  for (const field of ["productExternalId", "lotExternalId", "warehouseExternalId", "uom", "reason"] as const) {
    if (!text(entry[field])) problems.push(`${field} es obligatorio`);
  }
  if (typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity <= 0) problems.push("quantity debe ser mayor a 0");
  if (typeof entry.requestedAt !== "string" || Number.isNaN(Date.parse(entry.requestedAt))) problems.push("requestedAt no es una fecha ISO 8601");
  return problems;
}

export function assertValidStockEntryReport(entry: StockEntryReport): void {
  const problems = stockEntryReportProblems(entry);
  if (problems.length) throw new ErpError("validation", `Movimiento de stock inválido: ${problems.join("; ")}`);
}

export function stockImportReportProblems(entry: StockImportReport): string[] {
  const problems: string[] = [];
  if (entry.contractVersion !== ERP_CONTRACT_VERSION) problems.push(`contractVersion ${String(entry.contractVersion)} no soportada`);
  if (!text(entry.idempotencyKey) || !entry.idempotencyKey.startsWith("stock-import:")) problems.push("idempotencyKey inválida");
  for (const field of ["sku", "productName", "lotNumber", "warehouseExternalId", "uom"] as const) {
    if (!text(entry[field])) problems.push(`${field} es obligatorio`);
  }
  if (typeof entry.expirationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expirationDate)) problems.push("expirationDate no es una fecha YYYY-MM-DD");
  if (typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity <= 0) problems.push("quantity debe ser mayor a 0");
  if (typeof entry.requestedAt !== "string" || Number.isNaN(Date.parse(entry.requestedAt))) problems.push("requestedAt no es una fecha ISO 8601");
  return problems;
}

export function assertValidStockImportReport(entry: StockImportReport): void {
  const problems = stockImportReportProblems(entry);
  if (problems.length) throw new ErpError("validation", `Importación de stock inválida: ${problems.join("; ")}`);
}

export function palletScanReportProblems(scan: PalletScanReport): string[] {
  const problems: string[] = [];
  if (scan.contractVersion !== ERP_CONTRACT_VERSION) problems.push(`contractVersion ${String(scan.contractVersion)} no soportada`);
  if (scan.action !== "scan" && scan.action !== "unscan") problems.push("action inválida");
  const prefix = scan.action === "unscan" ? "pallet-unscan:" : "pallet-scan:";
  if (!text(scan.idempotencyKey) || !scan.idempotencyKey.startsWith(prefix)) problems.push("idempotencyKey inválida");
  if (!text(scan.scanIdempotencyKey) || !scan.scanIdempotencyKey.startsWith("pallet-scan:")) problems.push("scanIdempotencyKey inválida");
  if (scan.action === "scan" && scan.scanIdempotencyKey !== scan.idempotencyKey) problems.push("un escaneo se refiere a sí mismo");
  for (const field of ["orderExternalId", "palletCode", "productExternalId", "lotExternalId", "uom"] as const) {
    if (!text(scan[field])) problems.push(`${field} es obligatorio`);
  }
  if (typeof scan.quantity !== "number" || !Number.isFinite(scan.quantity) || scan.quantity <= 0) problems.push("quantity debe ser mayor a 0");
  if (typeof scan.at !== "string" || Number.isNaN(Date.parse(scan.at))) problems.push("at no es una fecha ISO 8601");
  return problems;
}

export function assertValidPalletScanReport(scan: PalletScanReport): void {
  const problems = palletScanReportProblems(scan);
  if (problems.length) throw new ErpError("validation", `Escaneo de despacho inválido: ${problems.join("; ")}`);
}
