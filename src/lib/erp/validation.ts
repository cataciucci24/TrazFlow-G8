import {
  ErpError,
  isSupportedContractVersion,
  isDispatchDocumentState,
  type DispatchDocumentStatus,
  type DispatchReport,
  DELIVERY_DISCREPANCY_TYPES,
  DELIVERY_PALLET_OUTCOMES,
  DELIVERY_RECEIPT_CONTENT_TYPES,
  DELIVERY_RECEIPT_MAX_BYTES,
  type DeliveryReceipt,
  type DeliveryReport,
  type ContentDifference,
  type ErpWarehouse,
  type PalletItem,
  type PalletScanReport,
  type StockEntryReport,
  type StockImportReport,
  STOCK_ENTRY_TYPES,
} from "./types.ts";

/** Problemas de forma del reporte, antes de enviarlo a cualquier proveedor. Vacío = válido. */
export function dispatchReportProblems(report: DispatchReport): string[] {
  const problems: string[] = [];

  if (!isSupportedContractVersion(report.contractVersion)) {
    problems.push(`contractVersion ${String(report.contractVersion)} no soportada`);
  }
  if (!text(report.idempotencyKey)) problems.push("idempotencyKey es obligatoria");
  if (!text(report.orderExternalId)) problems.push("orderExternalId es obligatorio");
  if (typeof report.dispatchedAt !== "string" || Number.isNaN(Date.parse(report.dispatchedAt))) problems.push("dispatchedAt no es una fecha ISO 8601");
  if (!text(report.operator?.id)) problems.push("operator.id es obligatorio");
  if (!Array.isArray(report.lines) || !report.lines.length) problems.push("el despacho no tiene líneas");

  // v1: un pallet por línea. v2 (pallets mixtos): una línea por ítem, identificada por pallet + producto + lote.
  const seen = new Set<string>();
  arrayOf(report.lines).forEach((line, index) => {
    const at = `lines[${index}]`;
    if (!isObject(line)) {
      problems.push(`${at} no es un objeto`);
      return;
    }
    const identity = report.contractVersion === 1
      ? line.palletCode
      : [line.palletCode, line.productExternalId, line.lotExternalId].join("\u0000");
    if (!text(line.palletCode)) problems.push(`${at}.palletCode es obligatorio`);
    else if (seen.has(identity)) {
      problems.push(report.contractVersion === 1
        ? `${at}.palletCode ${line.palletCode} está repetido`
        : `${at}: pallet ${line.palletCode}, producto ${line.productExternalId} y lote ${line.lotExternalId} repetidos (hay que sumarlos en una línea)`);
    } else seen.add(identity);
    if (!text(line.productExternalId)) problems.push(`${at}.productExternalId es obligatorio`);
    if (!text(line.lotExternalId)) problems.push(`${at}.lotExternalId es obligatorio`);
    if (!positiveQuantity(line.quantity)) problems.push(`${at}.quantity debe ser mayor a cero`);
    if (!text(line.uom)) problems.push(`${at}.uom es obligatoria`);
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
  if (!isSupportedContractVersion(value.contractVersion)) problems.push(`contractVersion ${String(value.contractVersion)} no soportada`);
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

  arrayOf(report.lines).forEach((line, index) => {
    if (!isObject(line)) {
      problems.push(`lines[${index}] no es un objeto`);
      return;
    }
    if (typeof line?.palletCode !== "string" || !line.palletCode.trim()) problems.push(`lines[${index}].palletCode es obligatorio`);
    if (!DELIVERY_PALLET_OUTCOMES.some((outcome) => outcome === line?.outcome)) problems.push(`lines[${index}].outcome inválido`);
  });
  arrayOf(report.discrepancies).forEach((difference, index) => {
    const at = `discrepancies[${index}]`;
    if (!isObject(difference)) {
      problems.push(`${at} no es un objeto`);
      return;
    }
    if (!DELIVERY_DISCREPANCY_TYPES.some((type) => type === difference?.type)) problems.push(`${at}.type inválido`);
    else if (difference.type === "content_mismatch") {
      if (report.contractVersion === 1) problems.push(`${at}: content_mismatch requiere contractVersion 2`);
      if (!Array.isArray(difference.contentDifferences) || !difference.contentDifferences.length) {
        problems.push(`${at}.contentDifferences es obligatorio con content_mismatch`);
      } else {
        difference.contentDifferences.forEach((content, contentIndex) => {
          problems.push(...contentDifferenceProblems(content, `${at}.contentDifferences[${contentIndex}]`));
        });
      }
    } else if (difference.contentDifferences !== undefined) {
      problems.push(`${at}.contentDifferences solo va con content_mismatch`);
    }
  });
  const hasDifferences = arrayOf(report.discrepancies).length > 0 || arrayOf(report.lines).some((line) => line?.outcome !== "delivered");
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
  if (!isSupportedContractVersion(entry.contractVersion)) problems.push(`contractVersion ${String(entry.contractVersion)} no soportada`);
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
  if (!isSupportedContractVersion(entry.contractVersion)) problems.push(`contractVersion ${String(entry.contractVersion)} no soportada`);
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
  if (!isSupportedContractVersion(scan.contractVersion)) problems.push(`contractVersion ${String(scan.contractVersion)} no soportada`);
  if (scan.action !== "scan" && scan.action !== "unscan") problems.push("action inválida");
  const prefix = scan.action === "unscan" ? "pallet-unscan:" : "pallet-scan:";
  if (!text(scan.idempotencyKey) || !scan.idempotencyKey.startsWith(prefix)) problems.push("idempotencyKey inválida");
  if (!text(scan.scanIdempotencyKey) || !scan.scanIdempotencyKey.startsWith("pallet-scan:")) problems.push("scanIdempotencyKey inválida");
  if (scan.action === "scan" && scan.scanIdempotencyKey !== scan.idempotencyKey) problems.push("un escaneo se refiere a sí mismo");
  for (const field of ["orderExternalId", "palletCode"] as const) {
    if (!text(scan[field])) problems.push(`${field} es obligatorio`);
  }
  if (scan.contractVersion === 2) {
    // v2: todos los ítems del pallet, sin producto + lote repetido.
    if (!Array.isArray(scan.items) || !scan.items.length) problems.push("items debe tener al menos un ítem");
    const seen = new Set<string>();
    arrayOf(scan.items).forEach((item, index) => {
      if (!isObject(item)) {
        problems.push(`items[${index}] no es un objeto`);
        return;
      }
      problems.push(...palletItemProblems(item, `items[${index}]`));
      const identity = `${item?.productExternalId}\u0000${item?.lotExternalId}`;
      if (seen.has(identity)) problems.push(`items[${index}]: producto ${item.productExternalId} y lote ${item.lotExternalId} repetidos`);
      seen.add(identity);
    });
  } else {
    for (const field of ["productExternalId", "lotExternalId", "uom"] as const) {
      if (!text((scan as Record<string, unknown>)[field])) problems.push(`${field} es obligatorio`);
    }
    const quantity = (scan as { quantity?: unknown }).quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) problems.push("quantity debe ser mayor a 0");
  }
  if (typeof scan.at !== "string" || Number.isNaN(Date.parse(scan.at))) problems.push("at no es una fecha ISO 8601");
  return problems;
}

export function assertValidPalletScanReport(scan: PalletScanReport): void {
  const problems = palletScanReportProblems(scan);
  if (problems.length) throw new ErpError("validation", `Escaneo de despacho inválido: ${problems.join("; ")}`);
}

/**
 * Ítems de un escaneo en la forma v2. Un evento v1 (un producto y un lote, como quedó guardado en el outbox) se
 * normaliza a un solo ítem; el payload no se modifica.
 */
export function palletScanItems(scan: PalletScanReport): PalletItem[] {
  if (scan.contractVersion === 2) return scan.items;
  return [{ productExternalId: scan.productExternalId, lotExternalId: scan.lotExternalId, quantity: scan.quantity, uom: scan.uom }];
}

/** Los payloads llegan del outbox como JSON: un elemento puede ser null o cualquier cosa. */
function isObject<T>(value: T): value is T & object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Lo que haya en un campo que debería ser lista; si no es lista, ningún elemento (el problema se reporta aparte). */
function arrayOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function positiveQuantity(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function palletItemProblems(item: PalletItem | null | undefined, at: string): string[] {
  if (!isObject(item)) return [`${at} no es un objeto`];
  const problems: string[] = [];
  for (const field of ["productExternalId", "lotExternalId", "uom"] as const) {
    if (!text(item[field])) problems.push(`${at}.${field} es obligatorio`);
  }
  if (!positiveQuantity(item.quantity)) problems.push(`${at}.quantity debe ser mayor a 0`);
  return problems;
}

/** `expected` null = sobrante, `detected` null = faltante; nunca los dos. Lo no identificado va como texto observado. */
function contentDifferenceProblems(difference: ContentDifference | null | undefined, at: string): string[] {
  if (!isObject(difference)) return [`${at} no es un objeto`];
  const problems: string[] = [];
  if (difference.expected == null && difference.detected == null) problems.push(`${at}: expected y detected no pueden ser los dos null`);
  if (difference.expected != null) problems.push(...palletItemProblems(difference.expected, `${at}.expected`));
  const detected = difference.detected;
  if (detected != null && !isObject(detected)) problems.push(`${at}.detected no es un objeto`);
  else if (detected != null) {
    for (const field of ["productExternalId", "lotExternalId", "observedSku", "observedLot"] as const) {
      if (detected[field] !== null && !text(detected[field])) problems.push(`${at}.detected.${field} debe ser texto o null`);
    }
    if (detected.productExternalId === null && !text(detected.observedSku)) {
      problems.push(`${at}.detected: sin productExternalId hace falta observedSku`);
    }
    if (detected.uom !== null && !text(detected.uom)) problems.push(`${at}.detected.uom debe ser texto o null`);
    if (detected.quantity !== null && !positiveQuantity(detected.quantity)) problems.push(`${at}.detected.quantity debe ser mayor a 0 o null`);
  }
  return problems;
}
