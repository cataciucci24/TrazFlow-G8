import "server-only";

import { safeLogFields, type ErpOutboxLogger } from "../erp-outbox/processor.ts";

/**
 * Logger de los cron (TRZ-104). Usa la misma lista cerrada de campos que el outbox (safeLogFields): nunca
 * payloads, claves, headers ni el secreto.
 */
export const consoleCronLogger: ErpOutboxLogger = {
  info: (event, fields) => console.info(`[cron] ${event}`, JSON.stringify(safeLogFields(fields))),
  warn: (event, fields) => console.warn(`[cron] ${event}`, JSON.stringify(safeLogFields(fields))),
  error: (event, fields) => console.error(`[cron] ${event}`, JSON.stringify(safeLogFields(fields))),
};
