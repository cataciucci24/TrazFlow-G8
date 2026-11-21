import "server-only";

import type { ErpClient } from "./client.ts";
import {
  ErpError,
  type BatchPickingPolicy,
  type DeliveryReportResult,
  type DispatchDocumentStatus,
  type DispatchReportResult,
  type ErpDispatchOrder,
  type ErpHealth,
  type ErpMasterData,
} from "./types.ts";

/**
 * Adaptador de Odoo (TRZ-113), solo lectura. Ver la sección "Odoo" de docs/erp-contract.md.
 * Por ahora es el esqueleto de la ola 0: todas las operaciones fallan con `config` salvo la política de lotes.
 */

export type OdooClientConfig = {
  baseUrl: string;
  database: string;
  username: string;
  apiKey: string;
  timeoutMs: number;
};

export type OdooClientOptions = {
  fetch?: typeof fetch;
  now?: () => Date;
};

function unsupported(): ErpError {
  return new ErpError("config", "Odoo: operación no soportada todavía");
}

export class OdooClient implements ErpClient {
  readonly provider = "odoo" as const;

  readonly #baseUrl: string;
  readonly #database: string;
  readonly #username: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(config: OdooClientConfig, options: OdooClientOptions = {}) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#database = config.database;
    this.#username = config.username;
    this.#apiKey = config.apiKey;
    this.#timeoutMs = config.timeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async healthcheck(): Promise<ErpHealth> {
    throw unsupported();
  }

  async pullMasterData(): Promise<ErpMasterData> {
    throw unsupported();
  }

  async pullDispatchOrders(): Promise<ErpDispatchOrder[]> {
    throw unsupported();
  }

  async reportDispatch(): Promise<DispatchReportResult> {
    throw unsupported();
  }

  async getDispatchStatus(): Promise<DispatchDocumentStatus> {
    throw unsupported();
  }

  async reportDelivery(): Promise<DeliveryReportResult> {
    throw unsupported();
  }

  async attachDeliveryReceipt(): Promise<DeliveryReportResult> {
    throw unsupported();
  }

  /** Odoo no expone una regla que TrazFlow lea todavía: se usa el valor por defecto del contrato. */
  async getBatchPickingPolicy(): Promise<BatchPickingPolicy> {
    return "fifo";
  }

  async reportStockEntry(): Promise<DeliveryReportResult> {
    throw unsupported();
  }

  async reportStockImport(): Promise<DeliveryReportResult> {
    throw unsupported();
  }

  async reportPalletScan(): Promise<DeliveryReportResult> {
    throw unsupported();
  }
}
