/**
 * Tipos del panel de integración ERP (US-ERP-05). Sin entorno ni red: seguro para componentes cliente.
 * Los estados son los reales de erp_sync_runs (20261019120000) y erp_outbox_events (20261019140000).
 */

export const SYNC_RUN_STATUSES = ["running", "success", "partial", "failed"] as const;
export const OUTBOX_STATUSES = ["pending", "processing", "sent", "failed"] as const;
export const ACTIVITY_STATUSES = ["running", "success", "partial", "pending", "processing", "sent", "failed"] as const;
/** `sync` = una ejecución de sincronización; el resto son event_type de erp_outbox_events. */
export const ACTIVITY_KINDS = ["sync", "dispatch_confirmed"] as const;

export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Origen de una sincronización (TRZ-104). Solo se muestra en la página Integración ERP. */
export type SyncTriggerSource = "manual" | "automatic";

export const SYNC_TRIGGER_LABELS: Record<SyncTriggerSource, string> = {
  manual: "Manual",
  automatic: "Automática",
};

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  sync: "Sincronización",
  dispatch_confirmed: "Reporte de despacho",
};

/**
 * Nombre de cualquier evento del outbox, también los de entrega de TRZ-103 (que todavía no tienen filtro propio
 * en el panel: aparecen en la actividad sin filtrar).
 */
const OUTBOX_EVENT_LABELS: Record<string, string> = {
  delivery_confirmed: "Informe de entrega",
  delivery_receipt_attached: "Remito firmado",
  stock_entry_requested: "Movimiento de stock",
  stock_import_requested: "Importación de stock",
  pallet_scanned: "Pallet escaneado",
  pallet_unscanned: "Pallet sacado del despacho",
};

export function activityKindLabel(kind: string): string {
  return (ACTIVITY_KIND_LABELS as Record<string, string>)[kind] ?? OUTBOX_EVENT_LABELS[kind] ?? kind;
}

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  running: "En curso",
  success: "Completa",
  partial: "Parcial",
  pending: "Pendiente",
  processing: "Enviando",
  sent: "Enviado",
  failed: "Fallido",
};

/** Badges del panel. Ver docs/erp-integration-panel.md. */
export const INTEGRATION_BADGES = ["healthy", "syncing", "pending", "failed", "stale"] as const;
export type IntegrationBadge = (typeof INTEGRATION_BADGES)[number];

export const INTEGRATION_BADGE_LABELS: Record<IntegrationBadge, string> = {
  healthy: "Saludable",
  syncing: "Sincronizando",
  pending: "Pendiente",
  failed: "Fallido",
  stale: "Desactualizado",
};

/**
 * Estado del remito en el ERP de un reporte enviado (TRZ-100). null = todavía sin consultar; not_tracked =
 * reporte anterior a TRZ-100 (no se consulta).
 */
export type ErpDocumentStatus = "draft" | "confirmed" | "cancelled" | "not_found" | "not_tracked";

export const ERP_DOCUMENT_STATUS_LABELS: Record<ErpDocumentStatus, string> = {
  draft: "Borrador",
  confirmed: "Confirmado",
  cancelled: "Anulado",
  not_found: "No encontrado",
  not_tracked: "Sin seguimiento",
};

/** Pestañas del panel (TRZ-112). `resumen` es la de entrada y no va en la URL. */
export const INTEGRATION_TABS = ["resumen", "actividad", "configuracion"] as const;
export type IntegrationTab = (typeof INTEGRATION_TABS)[number];

export const INTEGRATION_TAB_LABELS: Record<IntegrationTab, string> = {
  resumen: "Resumen",
  actividad: "Actividad",
  configuracion: "Configuración",
};

export type IntegrationFilters = {
  /** Pestaña visible. */
  tab: IntegrationTab;
  kind: ActivityKind | null;
  status: ActivityStatus | null;
  /** Fechas `YYYY-MM-DD` (hora de Argentina), ambas inclusive. */
  from: string | null;
  to: string | null;
  /** Orden externa, QR o id externo del pallet, lote o id externo de un error de sincronización. */
  search: string | null;
  page: number;
  /** Página de "Despachadas sin reportar". */
  unreportedPage: number;
  /** Evento abierto en el detalle. */
  event: { kind: ActivityKind; id: string } | null;
};

export type ActivityRow = {
  kind: ActivityKind;
  id: string;
  status: ActivityStatus;
  occurredAt: string;
  finishedAt: string | null;
  attempts: number | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
  /** Sanitizado en el servidor. */
  errorMessage: string | null;
  errorCount: number;
  orderId: string | null;
  orderExternalId: string | null;
  palletCount: number | null;
  erpReference: string | null;
  provider: string | null;
  /** Solo en reportes enviados; null = sin consultar (o una sincronización). */
  erpDocumentStatus: ErpDocumentStatus | null;
  /** Solo en sincronizaciones; null en los reportes. */
  triggerSource: SyncTriggerSource | null;
};

export type UnreportedOrder = {
  orderId: string;
  orderExternalId: string;
  orderStatus: string;
  confirmedAt: string;
  distributorName: string | null;
  eventId: string | null;
  /** `missing` = la orden se despachó pero no tiene reporte en el outbox. */
  eventStatus: OutboxStatus | "missing";
  attempts: number | null;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
};

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Se pidió una página posterior a la última. */
  outOfRange: boolean;
};

export type IntegrationSummary = {
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  sentCount: number;
  oldestPendingAt: string | null;
  runningSyncCount: number;
  lastRun: { id: string; status: SyncRunStatus; startedAt: string; finishedAt: string | null } | null;
  lastSuccessAt: string | null;
  unreportedCount: number;
};

/** Resultado del healthcheck. Nunca incluye URLs ni credenciales: solo el mensaje sanitizado de ErpError. */
export type ErpHealthState =
  | { status: "ok"; provider: string; latencyMs: number; checkedAt: string }
  | { status: "error"; code: string; message: string; checkedAt: string };

export type OutboxEventDetail = {
  kind: "dispatch_confirmed";
  id: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  erpReference: string | null;
  erpDuplicate: boolean | null;
  erpDocumentStatus: ErpDocumentStatus | null;
  erpDocumentCheckedAt: string | null;
  erpDocumentConfirmedSeenAt: string | null;
  order: { id: string; externalId: string | null; status: string | null };
  lines: {
    palletCode: string | null;
    orderLineExternalId: string | null;
    productExternalId: string | null;
    lotExternalId: string | null;
    quantity: number | null;
    uom: string | null;
  }[];
  retries: { requestedAt: string; requestedByName: string | null; previousAttempts: number; previousErrorCode: string | null; previousError: string | null }[];
};

export type SyncRunDetail = {
  kind: "sync";
  id: string;
  status: SyncRunStatus;
  provider: string;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  counters: Record<string, Record<string, number>>;
  errors: { entity: string; external_id: string | null; message: string }[];
  /** null en las automáticas: no las inicia un usuario. */
  triggeredByName: string | null;
  triggerSource: SyncTriggerSource;
};

export type IntegrationEventDetail = OutboxEventDetail | SyncRunDetail;

export type IntegrationActionState = {
  status: "idle" | "success" | "warning" | "error";
  message: string | null;
};

/* ---------- TRZ-112: configuración del ERP de la empresa ---------- */

/** Proveedores que se eligen en el panel. `none` = la empresa trabaja sin ERP (modo manual). */
export const ERP_CONFIG_PROVIDERS = ["none", "erpnext", "odoo", "mock"] as const;
export type ErpConfigProvider = (typeof ERP_CONFIG_PROVIDERS)[number];

export const ERP_CONFIG_PROVIDER_LABELS: Record<ErpConfigProvider, string> = {
  none: "Sin ERP (carga manual en TrazFlow)",
  erpnext: "ERPNext",
  odoo: "Odoo (solo lectura)",
  mock: "ERP simulado (pruebas)",
};

/**
 * Lo que el panel muestra de la configuración guardada. Nunca lleva credenciales: solo sus últimas 4 letras
 * (`apiKeyHint`, `apiSecretHint`) para mostrarlas enmascaradas.
 */
export type ErpConfigView = {
  provider: ErpConfigProvider;
  baseUrl: string | null;
  odooDatabase: string | null;
  odooUsername: string | null;
  itemGroup: string | null;
  timeoutSeconds: number | null;
  mockScenario: string | null;
  mockDispatchStatus: string | null;
  apiKeyHint: string | null;
  apiSecretHint: string | null;
  configuredAt: string | null;
  /** La empresa usa hoy las variables del servidor (transición, ERP_ENV_COMPANY_ID) y no tiene nada guardado. */
  usesServerVariables: boolean;
  /** El ERP simulado se ofrece solo fuera de producción. */
  allowMock: boolean;
};

/** Resultado de "Probar conexión" y "Guardar". */
export type ErpConfigActionState = IntegrationActionState & { errors?: string[] };
