/**
 * Contrato canónico TrazFlow ↔ ERP (US-ERP-02). Ver docs/erp-contract.md.
 *
 * Los DTOs no conocen a ningún ERP: identifican todo por `externalId` (id estable del ERP), nunca por nombre.
 * Este módulo no tiene secretos ni llamadas de red, así que se puede importar como tipo desde cualquier lado.
 */

/** Versión del contrato. Cambia solo ante cambios incompatibles de los payloads. */
export const ERP_CONTRACT_VERSION = 1;

export type ErpContractVersion = typeof ERP_CONTRACT_VERSION;

export const ERP_PROVIDERS = ["mock", "erpnext"] as const;

export type ErpProvider = (typeof ERP_PROVIDERS)[number];

export function isErpProvider(value: string): value is ErpProvider {
  return ERP_PROVIDERS.some((provider) => provider === value);
}

/* ---------- ERP → TrazFlow ---------- */

export type ErpProduct = {
  externalId: string;
  sku: string;
  name: string;
  /** Unidad de stock tal como la nombra el ERP. La traducción a products.unit_of_measure es de la sincronización. */
  uom: string;
  batchTracked: boolean;
  active: boolean;
  updatedAt: string;
};

export type ErpLot = {
  externalId: string;
  productExternalId: string;
  lotNumber: string;
  /** Fecha `YYYY-MM-DD` o null si el ERP no la informa. */
  manufacturingDate: string | null;
  expirationDate: string | null;
  active: boolean;
  updatedAt: string;
};

/**
 * Stock disponible por lote y depósito. El ERP no conoce pallets: el pallet físico (con su QR) lo crea TrazFlow
 * contra un lote del ERP.
 */
export type ErpStockBalance = {
  productExternalId: string;
  lotExternalId: string | null;
  warehouseExternalId: string;
  quantity: number;
  uom: string;
};

/**
 * Depósito del ERP (TRZ-101). `externalId` es el mismo valor que traen `ErpStockBalance.warehouseExternalId` y
 * `ErpDispatchOrderLine.warehouseExternalId` (en ERPNext, el `name` del Warehouse). Los grupos de depósitos no se
 * informan: no tienen stock.
 */
export type ErpWarehouse = {
  externalId: string;
  name: string;
  /** `false` = deshabilitado en el ERP. No se borra en TrazFlow: queda inactivo. */
  active: boolean;
  updatedAt: string;
};

export type ErpMasterData = {
  contractVersion: ErpContractVersion;
  fetchedAt: string;
  /**
   * Lista COMPLETA de depósitos, también con `updatedSince` (como el stock): un depósito que no viene se marca
   * inactivo en TrazFlow. Campo agregado al contrato v1 por TRZ-101.
   */
  warehouses: ErpWarehouse[];
  products: ErpProduct[];
  lots: ErpLot[];
  stock: ErpStockBalance[];
};

export type ErpDispatchOrderStatus = "pending" | "partially_delivered" | "delivered" | "cancelled";

export type ErpDispatchOrderLine = {
  externalId: string;
  productExternalId: string;
  quantity: number;
  uom: string;
  warehouseExternalId: string | null;
};

export type ErpDispatchOrder = {
  contractVersion: ErpContractVersion;
  externalId: string;
  status: ErpDispatchOrderStatus;
  /** Destinatario de la orden: dato de negocio, no un usuario de TrazFlow. */
  customer: { externalId: string; name: string };
  /** Fecha `YYYY-MM-DD` prevista de entrega. */
  scheduledDate: string | null;
  lines: ErpDispatchOrderLine[];
  updatedAt: string;
};

export type ErpPullOptions = {
  /** Solo registros modificados en el ERP desde este instante (ISO 8601). Sin valor, trae todo. */
  updatedSince?: string;
};

/* ---------- TrazFlow → ERP ---------- */

export type DispatchReportLine = {
  /** Línea de la orden del ERP que cubre este pallet, si se conoce. */
  orderLineExternalId: string | null;
  palletCode: string;
  productExternalId: string;
  lotExternalId: string;
  quantity: number;
  uom: string;
};

/** Despacho físico confirmado en TrazFlow: qué pallets y lotes salieron realmente. Un reporte por orden. */
export type DispatchReport = {
  contractVersion: ErpContractVersion;
  /** Igual en cada reintento del mismo despacho. Ver buildDispatchIdempotencyKey. */
  idempotencyKey: string;
  orderExternalId: string;
  dispatchedAt: string;
  operator: { id: string; name: string };
  lines: DispatchReportLine[];
};

export type DispatchReportResult = {
  /** Documento que generó el ERP (p. ej. el remito). */
  erpReference: string;
  /** true si el ERP ya tenía este idempotencyKey: el reporte se considera hecho y no se volvió a registrar. */
  duplicate: boolean;
  acceptedAt: string;
};

/**
 * Estado en el ERP del documento que generó un reporte de despacho (en ERPNext, el Delivery Note). Operación
 * agregada al contrato v1 por TRZ-100: es aditiva, los payloads existentes no cambian.
 *   - draft: el remito existe pero nadie lo confirmó; el stock del ERP todavía no bajó.
 *   - confirmed: confirmado; el ERP ya descontó el stock.
 *   - cancelled: anulado; el stock nunca salió del ERP.
 *   - not_found: no hay remito con esa clave (p. ej. se borró el borrador).
 */
export const DISPATCH_DOCUMENT_STATUSES = ["draft", "confirmed", "cancelled", "not_found"] as const;

export type DispatchDocumentState = (typeof DISPATCH_DOCUMENT_STATUSES)[number];

export type DispatchDocumentStatus = {
  status: DispatchDocumentState;
  /** Documento del ERP (p. ej. MAT-DN-2026-00001), o null si no se conoce. */
  erpReference: string | null;
};

export function isDispatchDocumentState(value: unknown): value is DispatchDocumentState {
  return DISPATCH_DOCUMENT_STATUSES.some((status) => status === value);
}

export type ErpHealth = {
  provider: ErpProvider;
  ok: true;
  latencyMs: number;
  checkedAt: string;
};

/**
 * Clave de idempotencia del reporte de despacho. Depende solo de la orden externa, así que confirmar dos veces o
 * reintentar el envío produce siempre la misma clave.
 */
export function buildDispatchIdempotencyKey(orderExternalId: string): string {
  const id = orderExternalId.trim();
  if (!id) throw new Error("orderExternalId vacío: no se puede armar la clave de idempotencia");
  return `dispatch:${id}`;
}

/* ---------- Errores ---------- */

export type ErpErrorCode =
  | "config" // falta o es inválida la configuración del proveedor
  | "unauthorized" // 401/403: credenciales inválidas o sin permisos
  | "validation" // 400/417/422: el ERP rechazó el dato; reintentar no lo arregla
  | "not_found" // 404: la entidad referida no existe en el ERP
  | "conflict" // 409: choque con un registro existente que no es el mismo reporte
  | "rate_limited" // 429
  | "timeout"
  | "network" // no hubo respuesta HTTP
  | "unavailable" // 5xx
  | "invalid_response"; // respuesta que no respeta el contrato

const RETRYABLE_CODES: ReadonlySet<ErpErrorCode> = new Set(["rate_limited", "timeout", "network", "unavailable"]);

/**
 * Error tipado del ERP. `message` está sanitizado: nunca contiene credenciales, headers ni trazas del ERP, así que
 * se puede guardar (erp_outbox_events.last_error) y mostrar a logística.
 */
export class ErpError extends Error {
  readonly code: ErpErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(code: ErpErrorCode, message: string, options: { status?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ErpError";
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
    this.status = options.status ?? null;
  }
}

export function isErpError(error: unknown): error is ErpError {
  return error instanceof ErpError;
}

/** Traduce un status HTTP al código del contrato. */
export function erpErrorCodeFromStatus(status: number): ErpErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "validation";
}
