import "server-only";

import type { ErpClient } from "../erp/client.ts";
import {
  ErpError,
  isErpError,
  type DeliveryReceipt,
  type DeliveryReport,
  type DispatchReport,
  type PalletScanReport,
  type StockEntryReport,
  type StockImportReport,
} from "../erp/types.ts";
import {
  deliveryReceiptProblems,
  deliveryReportProblems,
  dispatchReportProblems,
  palletScanReportProblems,
  stockEntryReportProblems,
  stockImportReportProblems,
} from "../erp/validation.ts";
import { emptyErpOutboxRunSummary, type ErpOutboxRunSummary } from "./types.ts";

/**
 * Procesador del outbox de reportes al ERP (US-ERP-04).
 *
 * Por cada evento: erp_outbox_claim (transacción corta que lo marca `processing`) → reportDispatch con el
 * payload guardado, fuera de cualquier transacción → erp_outbox_mark_sent | erp_outbox_mark_failed. El
 * backoff, el máximo de intentos y el lease los decide la base (20261019140000_erp_dispatch_outbox.sql):
 * acá solo se clasifica el error. El payload y la clave nunca se rearman: se reenvían tal cual.
 *
 * TRZ-103 sumó dos tipos de evento al mismo outbox. La operación del contrato sale del prefijo de la clave
 * (erp_outbox_claim no devuelve el event_type):
 *   dispatch:…          → reportDispatch
 *   delivery:…          → reportDelivery
 *   delivery-receipt:…  → attachDeliveryReceipt, con el archivo descargado del bucket delivery-receipts
 *
 * TRZ-62 y TRZ-63 sumaron:
 *   stock-entry:…                    → reportStockEntry (alta o baja en borrador)
 *   pallet-scan:… / pallet-unscan:…  → reportPalletScan (línea del Pick List de la orden)
 *
 * USH1 sumó:
 *   stock-import:…  → reportStockImport (crea producto y lote si faltan, y deja el stock en borrador)
 */

/** Bucket privado de los remitos firmados (20261028130000_trz103_delivery_receipts.sql). */
export const DELIVERY_RECEIPTS_BUCKET = "delivery-receipts";

/**
 * Lo que el procesador necesita de Supabase: llamar RPC y, para los remitos firmados (TRZ-103), descargar el
 * archivo. Un cliente de Supabase cumple las dos cosas.
 */
export type ErpOutboxDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
  storage?: {
    from(bucket: string): {
      download(path: string): PromiseLike<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

/**
 * Campos que se pueden loguear. Lista cerrada a propósito: nunca el payload (operador, pallets), ni
 * credenciales, headers o errores crudos de terceros.
 */
export type ErpOutboxLogFields = {
  eventId?: string;
  attempt?: number;
  provider?: string;
  code?: string;
  /** Solo mensajes de ErpError, que ya vienen sanitizados. */
  message?: string;
  status?: string | null;
  erpReference?: string;
  duplicate?: boolean;
  durationMs?: number;
  claimed?: number;
};

export type ErpOutboxLogger = {
  info(event: string, fields: ErpOutboxLogFields): void;
  warn(event: string, fields: ErpOutboxLogFields): void;
  error(event: string, fields: ErpOutboxLogFields): void;
};

const LOG_FIELDS: ReadonlyArray<keyof ErpOutboxLogFields> = [
  "eventId", "attempt", "provider", "code", "message", "status", "erpReference", "duplicate", "durationMs", "claimed",
];

/** Copia solo los campos permitidos: aunque alguien pase un objeto de más, no llega al log. */
export function safeLogFields(fields: ErpOutboxLogFields): ErpOutboxLogFields {
  const safe: Record<string, unknown> = {};
  for (const key of LOG_FIELDS) {
    if (fields[key] !== undefined) safe[key] = fields[key];
  }
  return safe as ErpOutboxLogFields;
}

export const consoleErpOutboxLogger: ErpOutboxLogger = {
  info: (event, fields) => console.info(`[erp-outbox] ${event}`, JSON.stringify(safeLogFields(fields))),
  warn: (event, fields) => console.warn(`[erp-outbox] ${event}`, JSON.stringify(safeLogFields(fields))),
  error: (event, fields) => console.error(`[erp-outbox] ${event}`, JSON.stringify(safeLogFields(fields))),
};

/** Timeout propio del procesador, por encima de ERP_TIMEOUT_MS y por debajo del lease (2 min). */
export const DEFAULT_REPORT_TIMEOUT_MS = 30_000;

export type ProcessErpOutboxParams = {
  /** Cliente autenticado como un usuario de logística o depósito: solo procesa eventos de su empresa. */
  db: ErpOutboxDb;
  /** Se llama una vez por corrida y solo si hay algo para enviar. */
  getClient: () => ErpClient;
  /** Máximo de eventos por corrida (la base lo limita a 50). */
  limit?: number;
  /** Solo los eventos de esta orden. Sin valor, todos los vencidos de la empresa. */
  aggregateId?: string | null;
  timeoutMs?: number;
  logger?: ErpOutboxLogger;
  /**
   * TRZ-103: procesar como el chofer, solo los eventos de entrega y remito de esta orden suya, con las RPC
   * erp_outbox_driver_* (20261028130100). Sin valor, las RPC de siempre (logística, depósito o service_role).
   */
  driverOrderId?: string;
};

/** No se pudieron tomar eventos (permisos, base caída). No se tocó nada. */
export class ErpOutboxClaimError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "ErpOutboxClaimError";
    this.code = code;
  }
}

type OutboxOperation =
  | { kind: "dispatch"; report: DispatchReport }
  | { kind: "delivery"; report: DeliveryReport }
  | { kind: "receipt"; receipt: DeliveryReceipt; storagePath: string }
  | { kind: "stockEntry"; entry: StockEntryReport }
  | { kind: "stockImport"; entry: StockImportReport }
  | { kind: "palletScan"; scan: PalletScanReport };

type SendResult = { erpReference: string; duplicate: boolean };

type ClaimedEvent = {
  id: string;
  idempotencyKey: string;
  payload: unknown;
  attempts: number;
};

type Failure = { code: string; message: string; retryable: boolean };

export async function processErpOutbox(params: ProcessErpOutboxParams): Promise<ErpOutboxRunSummary> {
  const { db } = params;
  const logger = params.logger ?? consoleErpOutboxLogger;
  const timeoutMs = params.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
  const summary = emptyErpOutboxRunSummary();

  const driver = typeof params.driverOrderId === "string";
  const rpcs = driver
    ? { claim: "erp_outbox_driver_claim", markSent: "erp_outbox_driver_mark_sent", markFailed: "erp_outbox_driver_mark_failed" }
    : { claim: "erp_outbox_claim", markSent: "erp_outbox_mark_sent", markFailed: "erp_outbox_mark_failed" };
  const claimed = await db.rpc(
    rpcs.claim,
    driver
      ? { p_order_id: params.driverOrderId }
      : { p_limit: params.limit ?? 10, p_aggregate_id: params.aggregateId ?? null },
  );
  if (claimed.error) {
    logger.error("claim_failed", { code: claimed.error.code });
    throw new ErpOutboxClaimError(
      claimed.error.code === "42501"
        ? "No tenés permisos para procesar reportes al ERP."
        : "No se pudieron leer los reportes pendientes al ERP.",
      claimed.error.code ?? null,
    );
  }

  const events = parseClaimedEvents(claimed.data);
  summary.claimed = events.length;
  if (!events.length) return summary;
  logger.info("claimed", { claimed: events.length });

  let client: ErpClient | null = null;
  let clientFailure: Failure | null = null;
  try {
    client = params.getClient();
  } catch (error) {
    clientFailure = classify(error);
  }

  for (const event of events) {
    const startedAt = Date.now();
    const base = { eventId: event.id, attempt: event.attempts, provider: client?.provider };
    let result: SendResult | null = null;
    let failure: Failure | null = clientFailure;

    if (!failure && client) {
      try {
        result = await withTimeout(send(client, toOperation(event), db), timeoutMs);
        if (typeof result?.erpReference !== "string" || !result.erpReference.trim()) {
          throw new ErpError("invalid_response", "El ERP no devolvió la referencia del documento.");
        }
      } catch (error) {
        result = null;
        failure = classify(error);
      }
    }
    const durationMs = Date.now() - startedAt;

    if (result) {
      const { data, error } = await db.rpc(rpcs.markSent, {
        p_event_id: event.id,
        p_attempt: event.attempts,
        p_erp_reference: result.erpReference,
        p_duplicate: result.duplicate === true,
      });
      if (error || data !== true) {
        summary.unrecorded += 1;
        logger.error("sent_not_recorded", { ...base, code: error?.code, erpReference: result.erpReference, durationMs });
        continue;
      }
      summary.sent += 1;
      if (result.duplicate) summary.duplicates += 1;
      logger.info("sent", { ...base, erpReference: result.erpReference, duplicate: result.duplicate === true, durationMs });
      continue;
    }

    const { code, message, retryable } = failure ?? classify(null);
    const { data, error } = await db.rpc(rpcs.markFailed, {
      p_event_id: event.id,
      p_attempt: event.attempts,
      p_error_code: code,
      p_error_message: message,
      p_retryable: retryable,
    });
    if (error || (data !== "pending" && data !== "failed")) {
      summary.unrecorded += 1;
      logger.error("failure_not_recorded", { ...base, code, durationMs });
      continue;
    }
    if (data === "pending") {
      summary.retrying += 1;
      logger.warn("retry_scheduled", { ...base, code, message, status: data, durationMs });
    } else {
      summary.failed += 1;
      logger.error("failed", { ...base, code, message, status: data, durationMs });
    }
  }

  return summary;
}

function parseClaimedEvents(data: unknown): ClaimedEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { id, idempotency_key: idempotencyKey, payload, attempts } = row as Record<string, unknown>;
    if (typeof id !== "string" || typeof idempotencyKey !== "string" || typeof attempts !== "number") return [];
    return [{ id, idempotencyKey, payload, attempts }];
  });
}

/** Qué operación del contrato corresponde al evento, con su payload ya validado. */
function toOperation(event: ClaimedEvent): OutboxOperation {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new ErpError("validation", "El reporte guardado no tiene el formato del contrato.");
  }
  const payload = event.payload as Record<string, unknown>;
  if (payload.idempotencyKey !== event.idempotencyKey) {
    throw new ErpError("validation", "La clave de idempotencia del reporte no coincide con la del evento.");
  }

  if (event.idempotencyKey.startsWith("delivery-receipt:")) {
    const storagePath = payload.storagePath;
    const receipt: DeliveryReceipt = {
      contractVersion: payload.contractVersion as DeliveryReceipt["contractVersion"],
      idempotencyKey: payload.idempotencyKey as string,
      orderExternalId: payload.orderExternalId as string,
      dispatchIdempotencyKey: payload.dispatchIdempotencyKey as string,
      fileName: payload.fileName as string,
      contentType: payload.contentType as string,
      sizeBytes: payload.sizeBytes as number,
      uploadedAt: payload.uploadedAt as string,
    };
    const problems = safeProblems(() => deliveryReceiptProblems(receipt));
    if (typeof storagePath !== "string" || !storagePath.trim()) problems.push("storagePath es obligatorio");
    assertNoProblems("Remito de entrega inválido", problems);
    return { kind: "receipt", receipt, storagePath: storagePath as string };
  }

  if (event.idempotencyKey.startsWith("stock-entry:")) {
    const entry = payload as unknown as StockEntryReport;
    assertNoProblems("Movimiento de stock inválido", safeProblems(() => stockEntryReportProblems(entry)));
    return { kind: "stockEntry", entry };
  }

  if (event.idempotencyKey.startsWith("stock-import:")) {
    const entry = payload as unknown as StockImportReport;
    assertNoProblems("Importación de stock inválida", safeProblems(() => stockImportReportProblems(entry)));
    return { kind: "stockImport", entry };
  }

  if (event.idempotencyKey.startsWith("pallet-scan:") || event.idempotencyKey.startsWith("pallet-unscan:")) {
    const scan = payload as unknown as PalletScanReport;
    assertNoProblems("Escaneo de despacho inválido", safeProblems(() => palletScanReportProblems(scan)));
    return { kind: "palletScan", scan };
  }

  if (event.idempotencyKey.startsWith("delivery:")) {
    const report = payload as unknown as DeliveryReport;
    assertNoProblems("Reporte de entrega inválido", safeProblems(() => deliveryReportProblems(report)));
    return { kind: "delivery", report };
  }

  const report = payload as unknown as DispatchReport;
  assertNoProblems("Reporte de despacho inválido", safeProblems(() => dispatchReportProblems(report)));
  return { kind: "dispatch", report };
}

function safeProblems(check: () => string[]): string[] {
  try {
    return check();
  } catch {
    return ["el reporte guardado no tiene el formato del contrato"];
  }
}

function assertNoProblems(title: string, problems: string[]): void {
  if (problems.length) throw new ErpError("validation", `${title}: ${problems.join("; ")}`.slice(0, 480));
}

async function send(client: ErpClient, operation: OutboxOperation, db: ErpOutboxDb): Promise<SendResult> {
  switch (operation.kind) {
    case "dispatch":
      return client.reportDispatch(operation.report);
    case "delivery":
      return client.reportDelivery(operation.report);
    case "receipt": {
      const content = await downloadReceipt(db, operation.storagePath);
      return client.attachDeliveryReceipt(operation.receipt, content);
    }
    case "stockEntry":
      return client.reportStockEntry(operation.entry);
    case "stockImport":
      return client.reportStockImport(operation.entry);
    case "palletScan":
      return client.reportPalletScan(operation.scan);
  }
}

/**
 * Baja el remito del bucket con la misma sesión que procesa (logística, depósito o service_role pueden leerlo).
 * Si no se puede, se reintenta: puede ser una falla pasajera de Storage.
 */
async function downloadReceipt(db: ErpOutboxDb, storagePath: string): Promise<Uint8Array> {
  if (!db.storage) {
    throw new ErpError("not_ready", "No hay acceso a los archivos para adjuntar el remito; se reintenta.");
  }
  let blob: Blob | null = null;
  try {
    const { data, error } = await db.storage.from(DELIVERY_RECEIPTS_BUCKET).download(storagePath);
    blob = error ? null : data;
  } catch {
    blob = null;
  }
  if (!blob) throw new ErpError("unavailable", "No se pudo leer el remito firmado guardado en TrazFlow.");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * ErpError trae su propia clasificación (docs/erp-contract.md §6). Cualquier otro error es inesperado: se
 * reintenta (puede ser transitorio) con un mensaje genérico, sin detalles que puedan filtrar datos.
 */
function classify(error: unknown): Failure {
  if (isErpError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: "unknown", message: "Error inesperado al reportar el despacho al ERP.", retryable: true };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ErpError("timeout", `El ERP no respondió en ${Math.round(timeoutMs / 1000)} s.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
