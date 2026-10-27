import "server-only";

import type { ErpClient } from "./client.ts";
import { MOCK_ERP_FIXTURES, type MockErpFixtures } from "./fixtures.ts";
import type { MockDispatchStatus, MockScenario } from "./mock-scenarios.ts";
import {
  ERP_CONTRACT_VERSION,
  ErpError,
  type DispatchDocumentStatus,
  type DispatchReport,
  type DispatchReportResult,
  type ErpDispatchOrder,
  type ErpHealth,
  type ErpMasterData,
  type ErpPullOptions,
} from "./types.ts";
import { assertValidDispatchReport, assertValidIdempotencyKey } from "./validation.ts";

export type MockErpClientOptions = {
  /** Falla permanente de todas las llamadas. `validation` solo afecta a reportDispatch. */
  scenario?: MockScenario;
  /** Fallas de una sola vez, consumidas en orden por las próximas llamadas (para probar reintentos). */
  failures?: MockScenario[];
  fixtures?: MockErpFixtures;
  now?: () => Date;
  /** Qué responde getDispatchStatus (ERP_MOCK_DISPATCH_STATUS). Por defecto `confirmed`. */
  dispatchStatus?: MockDispatchStatus;
};

type Operation = "healthcheck" | "pullMasterData" | "pullDispatchOrders" | "reportDispatch" | "getDispatchStatus";

type StoredReport = { fingerprint: string; result: DispatchReportResult };

/**
 * ERP en memoria con fixtures deterministas. Simula respuestas válidas, timeout (sin respuesta), 401, 422, 500 y
 * duplicados por idempotencyKey. Reportar un despacho marca la orden como entregada en la memoria del mock, pero
 * NO descuenta stock: el saldo del mock es siempre el de los fixtures.
 */
export class MockErpClient implements ErpClient {
  readonly provider = "mock" as const;

  readonly #scenario: MockScenario;
  readonly #failures: MockScenario[];
  readonly #data: MockErpFixtures;
  readonly #now: () => Date;
  readonly #reports = new Map<string, StoredReport>();
  readonly #dispatchStatus: MockDispatchStatus;

  constructor(options: MockErpClientOptions = {}) {
    this.#scenario = options.scenario ?? "ok";
    this.#failures = [...(options.failures ?? [])];
    this.#data = structuredClone(options.fixtures ?? MOCK_ERP_FIXTURES);
    this.#now = options.now ?? (() => new Date());
    this.#dispatchStatus = options.dispatchStatus ?? "confirmed";
  }

  async healthcheck(): Promise<ErpHealth> {
    this.#simulate("healthcheck");
    return { provider: this.provider, ok: true, latencyMs: 0, checkedAt: this.#now().toISOString() };
  }

  async pullMasterData(options: ErpPullOptions = {}): Promise<ErpMasterData> {
    this.#simulate("pullMasterData");
    const changed = updatedSinceFilter(options);
    return structuredClone({
      contractVersion: ERP_CONTRACT_VERSION,
      fetchedAt: this.#now().toISOString(),
      products: this.#data.products.filter(changed),
      lots: this.#data.lots.filter(changed),
      stock: this.#data.stock,
    });
  }

  async pullDispatchOrders(options: ErpPullOptions = {}): Promise<ErpDispatchOrder[]> {
    this.#simulate("pullDispatchOrders");
    const changed = updatedSinceFilter(options);
    return structuredClone(
      this.#data.orders.filter((order) => isOpen(order) && changed(order)),
    );
  }

  async reportDispatch(report: DispatchReport): Promise<DispatchReportResult> {
    this.#simulate("reportDispatch");
    assertValidDispatchReport(report);

    const fingerprint = stableStringify(report);
    const previous = this.#reports.get(report.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new ErpError("conflict", `La clave ${report.idempotencyKey} ya se usó con otro contenido.`, { status: 409 });
      }
      return { ...previous.result, duplicate: true };
    }

    const order = this.#data.orders.find((candidate) => candidate.externalId === report.orderExternalId);
    if (!order) throw validation(`La orden ${report.orderExternalId} no existe en el ERP.`);
    if (!isOpen(order)) throw validation(`La orden ${order.externalId} está ${order.status}: no admite despachos.`);

    for (const line of report.lines) {
      if (!this.#data.products.some((product) => product.externalId === line.productExternalId)) {
        throw validation(`El producto ${line.productExternalId} no existe en el ERP.`);
      }
      const lot = this.#data.lots.find((candidate) => candidate.externalId === line.lotExternalId);
      if (!lot || lot.productExternalId !== line.productExternalId) {
        throw validation(`El lote ${line.lotExternalId} no corresponde al producto ${line.productExternalId}.`);
      }
      if (line.orderLineExternalId && !order.lines.some((orderLine) => orderLine.externalId === line.orderLineExternalId)) {
        throw validation(`La línea ${line.orderLineExternalId} no pertenece a la orden ${order.externalId}.`);
      }
    }

    const acceptedAt = this.#now().toISOString();
    const result: DispatchReportResult = {
      erpReference: `MOCK-DN-${String(this.#reports.size + 1).padStart(4, "0")}`,
      duplicate: false,
      acceptedAt,
    };
    this.#reports.set(report.idempotencyKey, { fingerprint, result });
    order.status = "delivered";
    order.updatedAt = acceptedAt;
    return { ...result };
  }

  /**
   * Simula que administración confirma el remito enseguida (`confirmed`), salvo con ERP_MOCK_DISPATCH_STATUS=draft.
   * Si la clave no está en memoria (el proceso se reinició, o es otra instancia en Vercel) responde igual, con
   * erpReference null: el mock no guarda estado confiable entre procesos y no queremos pallets trabados en local.
   */
  async getDispatchStatus(idempotencyKey: string): Promise<DispatchDocumentStatus> {
    this.#simulate("getDispatchStatus");
    assertValidIdempotencyKey(idempotencyKey);
    const stored = this.#reports.get(idempotencyKey);
    return { status: this.#dispatchStatus, erpReference: stored?.result.erpReference ?? null };
  }

  #simulate(operation: Operation): void {
    const scenario = this.#failures.shift() ?? this.#scenario;
    if (scenario === "validation" && operation !== "reportDispatch") return;
    switch (scenario) {
      case "ok":
        return;
      case "timeout":
        throw new ErpError("timeout", "El ERP no respondió a tiempo (mock).");
      case "unauthorized":
        throw new ErpError("unauthorized", "Credenciales del ERP inválidas (mock).", { status: 401 });
      case "validation":
        throw validation("El ERP rechazó el reporte (mock).");
      case "server_error":
        throw new ErpError("unavailable", "Error interno del ERP (mock).", { status: 500 });
    }
  }
}

function validation(message: string): ErpError {
  return new ErpError("validation", message, { status: 422 });
}

/** JSON con claves ordenadas: un payload que pasó por jsonb (erp_outbox_events) vuelve con otro orden de claves. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isOpen(order: ErpDispatchOrder): boolean {
  return order.status === "pending" || order.status === "partially_delivered";
}

function updatedSinceFilter({ updatedSince }: ErpPullOptions): (record: { updatedAt: string }) => boolean {
  if (!updatedSince) return () => true;
  const since = Date.parse(updatedSince);
  if (Number.isNaN(since)) throw new ErpError("validation", "updatedSince no es una fecha ISO 8601.");
  return (record) => Date.parse(record.updatedAt) >= since;
}
