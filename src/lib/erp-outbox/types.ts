/** Tipos del outbox de reportes al ERP (US-ERP-04). Sin entorno ni red. */

/** Resultado de una corrida del procesador. */
export type ErpOutboxRunSummary = {
  claimed: number;
  sent: number;
  /** Enviados que el ERP ya tenía registrados (misma clave): éxito, sin una segunda salida. */
  duplicates: number;
  /** Fallas reintentables: quedan pendientes con backoff. */
  retrying: number;
  /** Fallas permanentes o reintentos agotados: requieren atención. */
  failed: number;
  /** El resultado no se pudo guardar (o llegó tarde): se retoma al vencer el lease. */
  unrecorded: number;
};

export function emptyErpOutboxRunSummary(): ErpOutboxRunSummary {
  return { claimed: 0, sent: 0, duplicates: 0, retrying: 0, failed: 0, unrecorded: 0 };
}
