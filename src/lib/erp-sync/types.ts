/**
 * Tipos de la sincronización con el ERP (US-ERP-03) que también usa la UI. Sin entorno ni red: seguro para
 * componentes cliente.
 */

export type ErpSyncStatus = "running" | "success" | "partial" | "failed";

export type ErpSyncEntity = "products" | "lots" | "stock" | "orders";

/**
 * Contadores por entidad tal como los guarda erp_sync_runs.counters. `protected` = existía con progreso local
 * y no se modificó; `absent` (stock) = pallets importados cuyo saldo bajó a 0 o ya no viene del ERP.
 */
export type ErpSyncCounters = Partial<Record<
  "received" | "created" | "updated" | "unchanged" | "protected" | "skipped" | "failed" | "absent"
  | "customers_created" | "customers_updated",
  number
>>;

export type ErpSyncRecordError = {
  entity: ErpSyncEntity;
  external_id: string | null;
  message: string;
};

export type ErpSyncRunSummary = {
  id: string;
  status: ErpSyncStatus;
  provider: string;
  startedAt: string;
  finishedAt: string | null;
  counters: Partial<Record<ErpSyncEntity, ErpSyncCounters>>;
  errors: ErpSyncRecordError[];
  errorMessage: string | null;
};

export type ErpSyncActionState = {
  status: "idle" | "success" | "partial" | "failed" | "error";
  message: string | null;
  run: ErpSyncRunSummary | null;
};

export type LinkErpWarehouseState = { error: string | null; success: string | null };

/** Origen de un registro sincronizable, para mostrar en tablas. */
export type ErpOrigin = {
  sourceSystem: "trazflow" | "erp";
  externalId: string | null;
  syncedAt: string | null;
};

export const ERP_SYNC_ENTITY_LABELS: Record<ErpSyncEntity, string> = {
  products: "Productos",
  lots: "Lotes",
  stock: "Pallets (saldos)",
  orders: "Órdenes",
};

export const ERP_SYNC_STATUS_LABELS: Record<ErpSyncStatus, string> = {
  running: "En curso",
  success: "Completa",
  partial: "Con errores",
  failed: "Fallida",
};

/** Mapea una fila de erp_sync_runs (snake_case) al resumen que usa la app. */
export function toErpSyncRunSummary(row: {
  id: string;
  status: ErpSyncStatus;
  provider: string;
  started_at: string;
  finished_at: string | null;
  counters: unknown;
  errors: unknown;
  error_message: string | null;
}): ErpSyncRunSummary {
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counters: (row.counters ?? {}) as ErpSyncRunSummary["counters"],
    errors: Array.isArray(row.errors) ? (row.errors as ErpSyncRecordError[]) : [],
    errorMessage: row.error_message,
  };
}

/** Mensaje de estado para la UI a partir de una ejecución terminada. */
export function describeErpSyncRun(run: ErpSyncRunSummary): string {
  const processed = (["products", "lots", "stock", "orders"] as const)
    .map((entity) => {
      const counters = run.counters[entity];
      if (!counters) return null;
      const ok = (counters.created ?? 0) + (counters.updated ?? 0) + (counters.unchanged ?? 0) + (counters.protected ?? 0);
      return `${ok} ${ERP_SYNC_ENTITY_LABELS[entity].toLowerCase()}`;
    })
    .filter(Boolean)
    .join(", ");
  const failed = Object.values(run.counters).reduce((sum, counters) => sum + (counters?.failed ?? 0), 0);

  switch (run.status) {
    case "success":
      return `Sincronización completa: ${processed || "sin datos"}.`;
    case "partial":
      return [
        `Sincronización con errores: ${processed || "sin datos"}`,
        failed ? `${failed} registro(s) no se pudieron importar` : null,
        run.errorMessage,
      ].filter(Boolean).join(". ") + ".";
    case "failed":
      return `No se pudo sincronizar con el ERP: ${run.errorMessage ?? "error desconocido"}. Los datos de TrazFlow no cambiaron.`;
    case "running":
      return "Hay una sincronización en curso.";
  }
}
