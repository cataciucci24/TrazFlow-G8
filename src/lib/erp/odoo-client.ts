import "server-only";

import type { ErpClient } from "./client.ts";
import type { ErpConfig } from "./config.ts";
import {
  ERP_CONTRACT_VERSION,
  ErpError,
  erpErrorCodeFromStatus,
  type BatchPickingPolicy,
  type DeliveryReportResult,
  type DispatchDocumentStatus,
  type DispatchReportResult,
  type ErpDispatchOrder,
  type ErpHealth,
  type ErpLot,
  type ErpMasterData,
  type ErpProduct,
  type ErpPullOptions,
  type ErpStockBalance,
  type ErpWarehouse,
} from "./types.ts";
import { assertValidErpWarehouses } from "./validation.ts";

/**
 * Adaptador de Odoo (TRZ-113), solo lectura: healthcheck y pullMasterData por la API externa JSON-RPC
 * (`POST /jsonrpc`, servicios `common` y `object`). Verificado contra Odoo 19.0 Community. Ver la sección "Odoo"
 * de docs/erp-contract.md para el mapeo y lo que Odoo no cumple tal cual.
 */

export type OdooClientConfig = Omit<Extract<ErpConfig, { provider: "odoo" }>, "provider">;

export type OdooClientOptions = {
  fetch?: typeof fetch;
  now?: () => Date;
};

/**
 * Odoo guarda los Datetime en UTC. El vencimiento del lote es un Datetime pero el contrato pide una fecha: se toma
 * el día en hora argentina, la de la demo (igual que ERPNEXT_UTC_OFFSET), para que un lote cargado a las 23:00 no
 * venza un día después.
 */
export const ODOO_DATE_UTC_OFFSET = "-03:00";
const DATE_OFFSET_MS = -3 * 60 * 60 * 1000;

const PAGE_SIZE = 500;
const MAX_ERROR_MESSAGE = 300;

/* ---------- Formas de Odoo que usa el adaptador ---------- */

/** Many2one como lo devuelve search_read: `[id, nombre visible]`, o `false` si está vacío. */
export type OdooMany2one = [number, string] | false;

export type OdooWarehouse = { id: number; name: string; active: boolean; write_date: string };

export type OdooProduct = {
  id: number;
  default_code: string | false;
  name: string;
  uom_id: OdooMany2one;
  tracking: "none" | "lot" | "serial";
  active: boolean;
  write_date: string;
};

/** `expiration_date` existe solo con el módulo product_expiry (Fechas de vencimiento). */
export type OdooLot = {
  id: number;
  name: string;
  product_id: OdooMany2one;
  expiration_date?: string | false;
  write_date: string;
};

/** `warehouse_id` es `location_id.warehouse_id`: el depósito al que pertenece la ubicación del quant. */
export type OdooQuant = {
  id: number;
  product_id: OdooMany2one;
  lot_id: OdooMany2one;
  warehouse_id: OdooMany2one;
  /** Cantidad a mano (no `available_quantity`, que descuenta lo reservado): ver aggregateOdooQuants. */
  quantity: number;
  product_uom_id: OdooMany2one;
};

type Domain = unknown[];

const WAREHOUSE_FIELDS = ["id", "name", "active", "write_date"];
const PRODUCT_FIELDS = ["id", "default_code", "name", "uom_id", "tracking", "active", "write_date"];
const LOT_FIELDS = ["id", "name", "product_id", "write_date"];
const QUANT_FIELDS = ["id", "product_id", "lot_id", "warehouse_id", "quantity", "product_uom_id"];

/* ---------- Mapeo Odoo → contrato ---------- */

export function mapOdooWarehouse(warehouse: OdooWarehouse): ErpWarehouse {
  return {
    externalId: String(warehouse.id),
    name: warehouse.name,
    active: warehouse.active,
    updatedAt: odooDatetimeToIso(warehouse.write_date),
  };
}

export function mapOdooProduct(product: OdooProduct): ErpProduct {
  return {
    externalId: String(product.id),
    // default_code es opcional en Odoo: sin él, el SKU es el id.
    sku: product.default_code || String(product.id),
    name: product.name,
    uom: many2oneName(product.uom_id, `unidad del producto ${product.id}`),
    batchTracked: product.tracking === "lot",
    active: product.active,
    updatedAt: odooDatetimeToIso(product.write_date),
  };
}

export function mapOdooLot(lot: OdooLot): ErpLot {
  return {
    externalId: String(lot.id),
    productExternalId: String(many2oneId(lot.product_id, `producto del lote ${lot.id}`)),
    lotNumber: lot.name,
    // Odoo estándar no tiene fecha de fabricación del lote.
    manufacturingDate: null,
    expirationDate: lot.expiration_date ? odooDatetimeToDate(lot.expiration_date) : null,
    // stock.lot no tiene campo active.
    active: true,
    updatedAt: odooDatetimeToIso(lot.write_date),
  };
}

/** Los quants pueden tener decimales: la suma se redondea para que, por ejemplo, 0,3 − 0,1 − 0,2 dé 0 y no 5,5e-17. */
const QUANTITY_DECIMALS = 6;
const roundQuantity = (value: number) => Number(value.toFixed(QUANTITY_DECIMALS));

/**
 * Suma los quants por producto + lote + depósito con la cantidad a mano (`quantity`), igual que ERPNext
 * (get_batch_qty). No se usa la disponible (a mano − reservada): TrazFlow ya descuenta lo despachado en borrador
 * (TRZ-100), así que con lo reservado se descontaría dos veces cuando Odoo soporte despachos.
 * Primero se suman TODOS los quants (también los negativos, que Odoo permite) y después se descartan los saldos ≤ 0:
 * −5 y +10 en el mismo depósito informan 5; un total de −3 no se informa. Un quant de una ubicación interna que no está
 * dentro de ningún depósito no se puede informar y se omite.
 */
export function aggregateOdooQuants(quants: OdooQuant[]): ErpStockBalance[] {
  const balances = new Map<string, ErpStockBalance>();
  for (const quant of quants) {
    if (typeof quant.quantity !== "number") throw invalidResponse(`quant ${quant.id} sin quantity`);
    if (!quant.warehouse_id || !quant.lot_id) continue;
    const productExternalId = String(many2oneId(quant.product_id, `producto del quant ${quant.id}`));
    const lotExternalId = String(quant.lot_id[0]);
    const warehouseExternalId = String(quant.warehouse_id[0]);
    const key = `${productExternalId}|${lotExternalId}|${warehouseExternalId}`;
    const balance = balances.get(key);
    if (balance) {
      balance.quantity += quant.quantity;
    } else {
      balances.set(key, {
        productExternalId,
        lotExternalId,
        warehouseExternalId,
        quantity: quant.quantity,
        uom: many2oneName(quant.product_uom_id, `unidad del quant ${quant.id}`),
      });
    }
  }
  return [...balances.values()]
    .map((balance) => ({ ...balance, quantity: roundQuantity(balance.quantity) }))
    .filter((balance) => balance.quantity > 0);
}

/* ---------- Cliente ---------- */

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
  #uid: Promise<number> | null = null;
  #requestId = 0;

  constructor(config: OdooClientConfig, options: OdooClientOptions = {}) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#database = config.database;
    this.#username = config.username;
    this.#apiKey = config.apiKey;
    this.#timeoutMs = config.timeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  /** `common.version` confirma que la URL es un Odoo; `authenticate` valida base, usuario y API key. */
  async healthcheck(): Promise<ErpHealth> {
    const started = Date.now();
    const version = await this.#call<{ server_version?: unknown }>("common", "version", []);
    if (!version || typeof version.server_version !== "string") throw invalidResponse("version sin server_version");
    this.#uid = null;
    await this.#authenticate();
    return { provider: this.provider, ok: true, latencyMs: Date.now() - started, checkedAt: this.#now().toISOString() };
  }

  async pullMasterData(options: ErpPullOptions = {}): Promise<ErpMasterData> {
    const since = writeDateSinceDomain(options);
    // Archivados incluidos en depósitos, productos y lotes: TrazFlow los marca inactivos.
    const withArchived = { active_test: false };

    // Depósitos: siempre la lista completa (sin updatedSince).
    const warehouses = (await this.#searchRead<OdooWarehouse>("stock.warehouse", [], WAREHOUSE_FIELDS, withArchived))
      .map(mapOdooWarehouse);
    assertValidErpWarehouses(warehouses);

    const products = await this.#searchRead<OdooProduct>(
      "product.product",
      [["is_storable", "=", true], ...since],
      PRODUCT_FIELDS,
      withArchived,
    );

    // Sin el módulo Fechas de vencimiento (product_expiry) el campo no existe: los lotes van sin vencimiento.
    const lotFields = await this.#execute<Record<string, unknown>>("stock.lot", "fields_get", [], { attributes: ["type"] });
    if (!lotFields || typeof lotFields !== "object") throw invalidResponse("fields_get de stock.lot");
    const lots = await this.#searchRead<OdooLot>(
      "stock.lot",
      [["product_id.tracking", "=", "lot"], ...since],
      "expiration_date" in lotFields ? [...LOT_FIELDS, "expiration_date"] : LOT_FIELDS,
      withArchived,
    );

    // El stock es una foto: completo aunque haya updatedSince. Solo ubicaciones internas y productos con lote.
    const quants = await this.#searchRead<OdooQuant>(
      "stock.quant",
      [["location_id.usage", "=", "internal"], ["lot_id", "!=", false], ["product_id.tracking", "=", "lot"]],
      QUANT_FIELDS,
    );

    return {
      contractVersion: ERP_CONTRACT_VERSION,
      fetchedAt: this.#now().toISOString(),
      warehouses,
      products: products.map(mapOdooProduct),
      lots: lots.map(mapOdooLot),
      stock: aggregateOdooQuants(quants),
    };
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

  /* ---------- JSON-RPC ---------- */

  /** uid del usuario de la API. Se pide una vez por instancia; si falla, el próximo intento vuelve a pedirlo. */
  #authenticate(): Promise<number> {
    this.#uid ??= this.#call<unknown>("common", "authenticate", [this.#database, this.#username, this.#apiKey, {}])
      .then((uid) => {
        if (typeof uid !== "number" || uid <= 0) {
          throw new ErpError("unauthorized", "Odoo no reconoce la base, el usuario o la API key configurados.");
        }
        return uid;
      })
      .catch((error: unknown) => {
        this.#uid = null;
        // Mensaje fijo: el de una base inexistente trae el host interno de Postgres.
        if (error instanceof ErpError && ["unauthorized", "validation", "not_found"].includes(error.code)) {
          throw new ErpError("unauthorized", "Odoo no reconoce la base, el usuario o la API key configurados.", { cause: error });
        }
        throw error;
      });
    return this.#uid;
  }

  async #execute<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
    const uid = await this.#authenticate();
    return this.#call<T>("object", "execute_kw", [this.#database, uid, this.#apiKey, model, method, args, kwargs]);
  }

  async #searchRead<T>(model: string, domain: Domain, fields: string[], context: Record<string, unknown> = {}): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.#execute<T[]>(model, "search_read", [], {
        domain,
        fields,
        offset,
        limit: PAGE_SIZE,
        order: "id asc",
        context,
      });
      if (!Array.isArray(page)) throw invalidResponse(`search_read de ${model} no devolvió una lista`);
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  /**
   * Una llamada JSON-RPC. Odoo responde los errores de negocio y de permisos con HTTP 200 y `error` en el cuerpo;
   * se traducen por el nombre de la excepción. Ni los args (llevan la API key) ni la traza (`data.debug`) llegan al
   * mensaje.
   */
  async #call<T>(service: "common" | "object", method: string, args: unknown[]): Promise<T> {
    const id = ++this.#requestId;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/jsonrpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id }),
        signal: AbortSignal.timeout(this.#timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ErpError("timeout", `Odoo no respondió en ${this.#timeoutMs} ms.`, { cause: error });
      }
      throw new ErpError("network", "No se pudo conectar con Odoo.", { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      const status = response.status;
      throw new ErpError(erpErrorCodeFromStatus(status), `Odoo respondió ${status}.`, { status });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidResponse("la respuesta no es JSON");
    }
    if (!body || typeof body !== "object") throw invalidResponse("la respuesta JSON-RPC no es un objeto");
    const record = body as { result?: unknown; error?: unknown };
    if ("error" in record && record.error) throw this.#rpcError(record.error);
    if (!("result" in record)) throw invalidResponse("la respuesta JSON-RPC no tiene result ni error");
    return record.result as T;
  }

  #rpcError(error: unknown): ErpError {
    const message = odooErrorMessage(error).replaceAll(this.#apiKey, "***");
    return new ErpError(odooErrorCode(error), `Odoo respondió con error: ${message}`);
  }
}

/* ---------- Utilidades ---------- */

type OdooRpcError = { code?: unknown; message?: unknown; data?: { name?: unknown; message?: unknown } };

/** Código del contrato para un error JSON-RPC de Odoo, por el nombre de la excepción de Python. */
export function odooErrorCode(error: unknown): ErpError["code"] {
  const rpc = (error ?? {}) as OdooRpcError;
  const name = typeof rpc.data?.name === "string" ? rpc.data.name : "";
  const message = typeof rpc.data?.message === "string" ? rpc.data.message : "";
  if (/AccessDenied|AccessError|SessionExpired/.test(name) || rpc.code === 100) return "unauthorized";
  // ERP_ODOO_DB que no existe: Odoo 19 responde psycopg2.OperationalError 'database "x" does not exist'.
  if (/OperationalError/.test(name) && /database ".*" does not exist/.test(message)) return "unauthorized";
  if (/MissingError/.test(name) || rpc.code === 404) return "not_found";
  if (/ValidationError|UserError|ValueError/.test(name)) return "validation";
  return "unavailable";
}

/** Texto que Odoo muestra al usuario (`data.message`), sin traza, sin HTML y recortado. */
export function odooErrorMessage(error: unknown): string {
  const rpc = (error ?? {}) as OdooRpcError;
  const raw = typeof rpc.data?.message === "string" && rpc.data.message
    ? rpc.data.message
    : typeof rpc.message === "string" ? rpc.message : "";
  const text = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "sin detalle";
  return text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE - 1)}…` : text;
}

function invalidResponse(detail: string): ErpError {
  return new ErpError("invalid_response", `Respuesta inesperada de Odoo: ${detail}.`);
}

function many2oneId(value: OdooMany2one | undefined, what: string): number {
  if (!Array.isArray(value) || typeof value[0] !== "number") throw invalidResponse(`falta ${what}`);
  return value[0];
}

function many2oneName(value: OdooMany2one | undefined, what: string): string {
  if (!Array.isArray(value) || typeof value[1] !== "string" || !value[1]) throw invalidResponse(`falta ${what}`);
  return value[1];
}

function writeDateSinceDomain({ updatedSince }: ErpPullOptions): Domain {
  if (!updatedSince) return [];
  if (Number.isNaN(Date.parse(updatedSince))) throw new ErpError("validation", "updatedSince no es una fecha ISO 8601.");
  return [["write_date", ">=", isoToOdooDatetime(updatedSince)]];
}

/** "2026-10-01 12:00:00" (UTC, como guarda Odoo) → ISO 8601. */
export function odooDatetimeToIso(value: string): string {
  const [date, time = "00:00:00"] = String(value).trim().split(/[ T]/);
  const parsed = Date.parse(`${date}T${time.slice(0, 12)}Z`);
  if (Number.isNaN(parsed)) throw invalidResponse(`fecha inválida "${value}"`);
  return new Date(parsed).toISOString();
}

/** ISO 8601 → "YYYY-MM-DD HH:MM:SS" en UTC, el formato de los filtros de Odoo. */
export function isoToOdooDatetime(value: string): string {
  return new Date(Date.parse(value)).toISOString().slice(0, 19).replace("T", " ");
}

/** Datetime de Odoo (UTC) → `YYYY-MM-DD` del día en ODOO_DATE_UTC_OFFSET. */
export function odooDatetimeToDate(value: string): string {
  return new Date(Date.parse(odooDatetimeToIso(value)) + DATE_OFFSET_MS).toISOString().slice(0, 10);
}
