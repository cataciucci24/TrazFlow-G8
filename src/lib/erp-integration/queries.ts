import "server-only";

import { createClient } from "@/lib/supabase/server";
import { ACTIVITY_PAGE_SIZE, toActivityRpcArgs, UNREPORTED_PAGE_SIZE } from "@/lib/erp-integration/filters";
import { sanitizeErpErrorText } from "@/lib/erp-integration/sanitize";
import type {
  ActivityKind,
  ActivityRow,
  ActivityStatus,
  ErpDocumentStatus,
  IntegrationEventDetail,
  IntegrationFilters,
  IntegrationSummary,
  OutboxStatus,
  Page,
  SyncRunStatus,
  UnreportedOrder,
} from "@/lib/erp-integration/types";

/**
 * Lecturas del panel. Todas pasan por funciones SECURITY INVOKER (RLS de la sesión + rol logística) y los
 * mensajes de error se sanitizan acá, en el servidor, antes de llegar a cualquier componente.
 */

type ActivityRpcRow = {
  kind: ActivityKind;
  id: string;
  status: ActivityStatus;
  occurred_at: string;
  finished_at: string | null;
  attempts: number | null;
  next_attempt_at: string | null;
  error_code: string | null;
  error_message: string | null;
  error_count: number;
  order_id: string | null;
  order_external_id: string | null;
  pallet_count: number | null;
  erp_reference: string | null;
  provider: string | null;
  erp_document_status: ErpDocumentStatus | null;
  total_count: number;
};

function fail(what: string, error: { code?: string }): never {
  throw new Error(`No se pudo leer ${what} de la integración ERP (${error.code ?? "sin código"}).`);
}

function toPage<T>(rows: T[], total: number, page: number, pageSize: number): Page<T> {
  return { rows, total, page, pageSize, outOfRange: rows.length === 0 && page > 1 };
}

export async function getIntegrationSummary(): Promise<IntegrationSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erp_integration_summary");
  if (error) fail("el resumen", error);
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    pendingCount: Number(row.pending_count ?? 0),
    processingCount: Number(row.processing_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    sentCount: Number(row.sent_count ?? 0),
    oldestPendingAt: row.oldest_pending_at ?? null,
    runningSyncCount: Number(row.running_sync_count ?? 0),
    lastRun: row.last_run_id
      ? { id: row.last_run_id, status: row.last_run_status as SyncRunStatus, startedAt: row.last_run_started_at, finishedAt: row.last_run_finished_at ?? null }
      : null,
    lastSuccessAt: row.last_success_at ?? null,
    unreportedCount: Number(row.unreported_count ?? 0),
  };
}

export async function getIntegrationActivity(filters: IntegrationFilters, pageSize = ACTIVITY_PAGE_SIZE): Promise<Page<ActivityRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erp_integration_activity", toActivityRpcArgs(filters, pageSize));
  if (error) fail("la actividad", error);
  const raw = (data ?? []) as ActivityRpcRow[];
  const rows = raw.map((row): ActivityRow => ({
    kind: row.kind,
    id: row.id,
    status: row.status,
    occurredAt: row.occurred_at,
    finishedAt: row.finished_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    errorCode: row.error_code,
    errorMessage: sanitizeErpErrorText(row.error_message),
    errorCount: row.error_count ?? 0,
    orderId: row.order_id,
    orderExternalId: row.order_external_id,
    palletCount: row.pallet_count,
    erpReference: row.erp_reference,
    provider: row.provider,
    erpDocumentStatus: row.erp_document_status ?? null,
  }));
  return toPage(rows, Number(raw[0]?.total_count ?? 0), filters.page, pageSize);
}

type UnreportedRpcRow = {
  order_id: string;
  order_external_id: string;
  order_status: string;
  confirmed_at: string;
  distributor_name: string | null;
  event_id: string | null;
  event_status: OutboxStatus | "missing";
  attempts: number | null;
  last_error_code: string | null;
  next_attempt_at: string | null;
  total_count: number;
};

export async function getDispatchedUnreported(page: number, pageSize = UNREPORTED_PAGE_SIZE): Promise<Page<UnreportedOrder>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erp_dispatched_unreported", { p_limit: pageSize, p_offset: (page - 1) * pageSize });
  if (error) fail("las órdenes sin reportar", error);
  const raw = (data ?? []) as UnreportedRpcRow[];
  const rows = raw.map((row): UnreportedOrder => ({
    orderId: row.order_id,
    orderExternalId: row.order_external_id,
    orderStatus: row.order_status,
    confirmedAt: row.confirmed_at,
    distributorName: row.distributor_name,
    eventId: row.event_id,
    eventStatus: row.event_status,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    nextAttemptAt: row.next_attempt_at,
  }));
  return toPage(rows, Number(raw[0]?.total_count ?? 0), page, pageSize);
}

/** Detalle sanitizado de un evento, o null si no existe o no es de la empresa. */
export async function getIntegrationEventDetail(kind: ActivityKind, id: string): Promise<IntegrationEventDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erp_integration_event_detail", { p_kind: kind, p_id: id });
  if (error) fail("el detalle del evento", error);
  if (!data) return null;
  return sanitizeDetail(data as IntegrationEventDetail);
}

export function sanitizeDetail(detail: IntegrationEventDetail): IntegrationEventDetail {
  if (detail.kind === "sync") {
    return {
      ...detail,
      errorMessage: sanitizeErpErrorText(detail.errorMessage),
      errors: (detail.errors ?? []).map((error) => ({
        entity: error.entity,
        external_id: error.external_id,
        message: sanitizeErpErrorText(error.message) ?? "Error sin descripción.",
      })),
    };
  }
  return {
    ...detail,
    errorMessage: sanitizeErpErrorText(detail.errorMessage),
    retries: (detail.retries ?? []).map((retry) => ({ ...retry, previousError: sanitizeErpErrorText(retry.previousError) })),
  };
}
