/**
 * Tipos de la sincronización con el ERP (US-ERP-03) que también usa la UI. Sin entorno ni red: seguro para
 * componentes cliente.
 */

export type ErpSyncStatus = "running" | "success" | "partial" | "failed";

/**
 * Etapas de una sincronización. `dispatch_documents` (TRZ-100) es la consulta del estado de los remitos de los
 * despachos ya reportados, que corre antes de traer los maestros. `warehouses` (TRZ-101) va antes que productos.
 */
export type ErpSyncEntity = "warehouses" | "products" | "lots" | "stock" | "orders" | "dispatch_documents";

/** Entidad de un error auditado: la etapa, salvo los remitos, que se auditan uno por uno como `dispatch_document`. */
export type ErpSyncErrorEntity = Exclude<ErpSyncEntity, "dispatch_documents"> | "dispatch_document";

/**
 * Contadores por entidad tal como los guarda erp_sync_runs.counters. `protected` = orden que existía con progreso
 * local y no se modificó; `absent` (stock) = saldos que ya no vienen del ERP (quedan en 0). Los remitos cuentan
 * cuántos se consultaron (`received`) y en qué estado quedaron. Depósitos (TRZ-101): `adopted` = un depósito de
 * TrazFlow que ya estaba vinculado pasa a ser ese depósito del ERP; `merged` = vinculado a un depósito que ya es
 * de otro depósito del ERP (sus saldos se suman ahí); `deactivated` = dejó de venir del ERP.
 */
export type ErpSyncCounters = Partial<Record<
  "received" | "created" | "updated" | "unchanged" | "protected" | "skipped" | "failed" | "absent"
  | "customers_created" | "customers_updated" | "draft" | "confirmed" | "cancelled" | "not_found"
  | "adopted" | "merged" | "deactivated",
  number
>>;

export type ErpSyncRecordError = {
  entity: ErpSyncErrorEntity;
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
  /** Avisos que no son errores (TRZ-101: qué pasó con cada depósito). Misma forma que `errors`. */
  notices: ErpSyncRecordError[];
  errorMessage: string | null;
};

export type ErpSyncActionState = {
  status: "idle" | "success" | "partial" | "failed" | "error";
  message: string | null;
  run: ErpSyncRunSummary | null;
};

/** Origen de un registro sincronizable, para mostrar en tablas. */
export type ErpOrigin = {
  sourceSystem: "trazflow" | "erp";
  externalId: string | null;
  syncedAt: string | null;
};

export const ERP_SYNC_ENTITY_LABELS: Record<ErpSyncEntity | ErpSyncErrorEntity, string> = {
  warehouses: "Depósitos",
  products: "Productos",
  lots: "Lotes",
  stock: "Saldos de stock",
  orders: "Órdenes",
  dispatch_documents: "Remitos",
  dispatch_document: "Remito",
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
  /** Puede faltar en filas leídas antes de TRZ-101 o con un select viejo. */
  notices?: unknown;
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
    notices: Array.isArray(row.notices) ? (row.notices as ErpSyncRecordError[]) : [],
    errorMessage: row.error_message,
  };
}

/** Mensaje de estado para la UI a partir de una ejecución terminada. */
export function describeErpSyncRun(run: ErpSyncRunSummary): string {
  const processed = (["warehouses", "products", "lots", "stock", "orders"] as const)
    .map((entity) => {
      const counters = run.counters[entity];
      if (!counters) return null;
      const ok = (counters.created ?? 0) + (counters.updated ?? 0) + (counters.unchanged ?? 0) + (counters.protected ?? 0)
        + (counters.adopted ?? 0) + (counters.merged ?? 0);
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
