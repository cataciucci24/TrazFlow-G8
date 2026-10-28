import "server-only";

import type { ErpClient } from "../erp/client.ts";
import { isErpError, type DispatchDocumentStatus } from "../erp/types.ts";
import { assertValidDispatchDocumentStatus } from "../erp/validation.ts";
import type { ErpOutboxDb } from "./processor.ts";

/**
 * Consulta en el ERP el remito de los reportes de despacho ya enviados (TRZ-100) y guarda la respuesta en el
 * evento del outbox:
 *
 *   erp_outbox_dispatch_documents_due → ErpClient.getDispatchStatus → erp_outbox_record_dispatch_document
 *
 * Con eso el tope por saldo sabe cuándo el ERP ya descontó lo despachado (docs/erp-sync.md, "Tope por saldo").
 *
 * No depende de una sesión de usuario: `db` puede ser el cliente de un usuario de logística o depósito (las RPC
 * lo limitan a su empresa) o uno con service_role, que es como lo va a llamar el cron de TRZ-104. En los dos
 * casos hay que indicar `companyId`. Hoy lo llama syncCompanyFromErp antes de pullMasterData.
 *
 * Nunca lanza: lo que falla queda en `errors` (para la auditoría de la sincronización) y en `failed`. Si el ERP
 * no responde (timeout, red, 5xx, 429) corta la consulta: los eventos que faltan se retoman la próxima vez.
 */

export type DispatchDocumentCounters = {
  received: number;
  draft: number;
  confirmed: number;
  cancelled: number;
  not_found: number;
  failed: number;
};

export type DispatchDocumentError = {
  /** Clave de idempotencia del reporte (dispatch:{orden}) o null si falló la consulta entera. */
  external_id: string | null;
  message: string;
};

export type DispatchDocumentCheckResult = {
  counters: DispatchDocumentCounters;
  errors: DispatchDocumentError[];
};

export type CheckErpDispatchDocumentsParams = {
  db: ErpOutboxDb;
  /** Se llama una sola vez y solo si hay remitos para consultar. */
  getClient: () => ErpClient;
  companyId: string;
  /** Máximo de reportes por corrida (la base lo limita a 50). */
  limit?: number;
};

export const DEFAULT_DISPATCH_DOCUMENT_LIMIT = 20;

type DueEvent = { id: string; idempotencyKey: string };

export function emptyDispatchDocumentCounters(): DispatchDocumentCounters {
  return { received: 0, draft: 0, confirmed: 0, cancelled: 0, not_found: 0, failed: 0 };
}

export async function checkErpDispatchDocuments(params: CheckErpDispatchDocumentsParams): Promise<DispatchDocumentCheckResult> {
  const counters = emptyDispatchDocumentCounters();
  const errors: DispatchDocumentError[] = [];

  const due = await params.db.rpc("erp_outbox_dispatch_documents_due", {
    p_company_id: params.companyId,
    p_limit: params.limit ?? DEFAULT_DISPATCH_DOCUMENT_LIMIT,
  });
  if (due.error) {
    errors.push({
      external_id: null,
      message: due.error.code === "42501"
        ? "No tenés permisos para consultar los remitos en el ERP."
        : "No se pudieron leer los reportes a consultar en el ERP.",
    });
    return { counters, errors };
  }

  const events = parseDueEvents(due.data);
  counters.received = events.length;
  if (!events.length) return { counters, errors };

  let client: ErpClient;
  try {
    client = params.getClient();
  } catch (error) {
    counters.failed = events.length;
    errors.push({ external_id: null, message: errorMessage(error) });
    return { counters, errors };
  }

  for (const [index, event] of events.entries()) {
    let result: DispatchDocumentStatus;
    try {
      const response = await client.getDispatchStatus(event.idempotencyKey);
      assertValidDispatchDocumentStatus(response);
      result = response;
    } catch (error) {
      counters.failed += 1;
      errors.push({ external_id: event.idempotencyKey, message: errorMessage(error) });
      if (isErpError(error) && error.retryable) {
        // El ERP no está respondiendo: no tiene sentido seguir preguntando por los demás.
        counters.failed += events.length - index - 1;
        break;
      }
      continue;
    }

    const recorded = await params.db.rpc("erp_outbox_record_dispatch_document", {
      p_event_id: event.id,
      p_status: result.status,
      p_erp_reference: result.erpReference,
    });
    if (recorded.error || recorded.data !== true) {
      counters.failed += 1;
      errors.push({ external_id: event.idempotencyKey, message: "No se pudo guardar el estado del remito en TrazFlow." });
      continue;
    }
    counters[result.status] += 1;
  }

  return { counters, errors };
}

function parseDueEvents(data: unknown): DueEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { id, idempotency_key: idempotencyKey } = row as Record<string, unknown>;
    if (typeof id !== "string" || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) return [];
    return [{ id, idempotencyKey }];
  });
}

/** Solo mensajes de ErpError (ya sanitizados); cualquier otro error, uno genérico. */
function errorMessage(error: unknown): string {
  if (isErpError(error)) return `Al consultar el remito en el ERP: ${error.message}`;
  return "Error inesperado al consultar el remito en el ERP.";
}
