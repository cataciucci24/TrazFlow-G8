import "server-only";

import type { ErpClient } from "./client.ts";
import {
  ERP_CONTRACT_VERSION,
  ErpError,
  erpErrorCodeFromStatus,
  isErpError,
  type DeliveryDiscrepancyKind,
  type DeliveryPalletOutcome,
  type DeliveryReceipt,
  type DeliveryReport,
  type DeliveryReportResult,
  type DispatchDocumentStatus,
  type DispatchReport,
  type DispatchReportResult,
  type ErpDispatchOrder,
  type ErpDispatchOrderStatus,
  type ErpHealth,
  type ErpLot,
  type ErpMasterData,
  type ErpProduct,
  type ErpPullOptions,
  type ErpStockBalance,
  type ErpWarehouse,
} from "./types.ts";
import {
  assertValidDeliveryReceipt,
  assertValidDeliveryReport,
  assertValidDispatchReport,
  assertValidErpWarehouses,
  assertValidIdempotencyKey,
} from "./validation.ts";

/**
 * Adaptador REST de ERPNext / Frappe (v15). Ver la sección "ERPNext" de docs/erp-contract.md para el mapeo de
 * doctypes y los campos personalizados que hay que crear en la instancia.
 */

/** Frappe guarda fechas en la zona del servidor y sin offset. La instancia de la demo corre en hora argentina. */
export const ERPNEXT_UTC_OFFSET = "-03:00";
const OFFSET_MS = -3 * 60 * 60 * 1000;

const PAGE_SIZE = 500;
const MAX_ERROR_MESSAGE = 300;

/** Campos personalizados que la instancia de ERPNext debe tener (Customize Form). */
export const ERPNEXT_CUSTOM_FIELDS = {
  idempotencyKey: "trazflow_idempotency_key", // Delivery Note, Data, único
  operator: "trazflow_operator", // Delivery Note, Data
  palletCode: "trazflow_pallet_code", // Delivery Note Item, Data
} as const;

/** Etiqueta (tag de Frappe) que deja TrazFlow en un remito cuya entrega cerró con diferencias (TRZ-103). */
export const ERPNEXT_REVIEW_TAG = "TrazFlow: revisar entrega";

const OPEN_SALES_ORDER_STATUSES = ["To Deliver and Bill", "To Deliver"];

export type ErpNextClientOptions = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => Date;
};

/* ---------- Formas de ERPNext que usa el adaptador ---------- */

export type ErpNextItem = {
  name: string;
  item_code: string;
  item_name: string;
  stock_uom: string;
  has_batch_no: 0 | 1;
  disabled: 0 | 1;
  modified: string;
};

export type ErpNextBatch = {
  name: string;
  item: string;
  manufacturing_date: string | null;
  expiry_date: string | null;
  disabled: 0 | 1;
  modified: string;
};

export type ErpNextBatchQty = { batch_no: string; warehouse: string; qty: number };

/** Depósito. `name` es el id ("Stores - SRV", con la abreviatura de la empresa); los grupos no tienen stock. */
export type ErpNextWarehouse = {
  name: string;
  warehouse_name: string;
  is_group: 0 | 1;
  disabled: 0 | 1;
  modified: string;
};

export type ErpNextSalesOrderItem = {
  name: string;
  item_code: string;
  stock_qty: number;
  stock_uom: string;
  warehouse: string | null;
};

export type ErpNextSalesOrder = {
  name: string;
  customer: string;
  customer_name: string;
  delivery_date: string | null;
  status: string;
  docstatus: 0 | 1 | 2;
  per_delivered: number;
  modified: string;
  items: ErpNextSalesOrderItem[];
};

type ErpNextDeliveryNoteRef = { name: string; creation: string };

/** Remito con su estado: 0 borrador, 1 confirmado (submitted), 2 anulado. */
export type ErpNextDeliveryNoteState = { name: string; docstatus: 0 | 1 | 2 };

export type ErpNextDeliveryNote = ErpNextDeliveryNoteRef & {
  posting_date: string;
  /** Frappe lo devuelve como timedelta: "9:30:00" o "11:30:00.000000". */
  posting_time: string;
  trazflow_operator?: string | null;
  items: {
    item_code: string;
    qty: number;
    uom: string;
    batch_no?: string | null;
    trazflow_pallet_code?: string | null;
  }[];
};

type Filter = [string, string, unknown];

/* ---------- Entrega (TRZ-103) → ERPNext ---------- */

const OUTCOME_LABELS: Record<DeliveryPalletOutcome, string> = {
  delivered: "Entregado",
  missing: "Faltante",
  damaged: "Dañado",
};

const DISCREPANCY_LABELS: Record<DeliveryDiscrepancyKind, string> = {
  missing: "Faltante",
  surplus: "Sobrante",
  damaged: "Dañado",
  wrong_order: "No corresponde a la orden",
};

/** Marca que identifica el comentario de una entrega: con ella se detecta un reintento (idempotencia). */
export function deliveryCommentMarker(idempotencyKey: string): string {
  return `[trazflow:${idempotencyKey}]`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Comentario del Delivery Note con el resultado por pallet. HTML simple, que es lo que muestra Frappe. */
export function buildDeliveryComment(report: DeliveryReport): string {
  const parts = [
    `<p><b>Entrega informada por TrazFlow</b> ${escapeHtml(deliveryCommentMarker(report.idempotencyKey))}</p>`,
  ];
  if (report.needsReview) {
    parts.push("<p><b>⚠ La entrega cerró con diferencias: revisar antes de confirmar el remito.</b></p>");
  }
  parts.push(
    `<p>Chofer: ${escapeHtml(report.driver.name || report.driver.id)} · Fecha: ${escapeHtml(isoToFrappeDatetime(report.deliveredAt))}</p>`,
    `<p>Pallets:</p><ul>${report.lines
      .map((line) => `<li>${escapeHtml(line.palletCode)}: ${OUTCOME_LABELS[line.outcome]}</li>`)
      .join("")}</ul>`,
  );
  if (report.discrepancies.length) {
    parts.push(`<p>Diferencias:</p><ul>${report.discrepancies
      .map((difference) => `<li>${escapeHtml(difference.palletCode ?? "sin código")}: ${DISCREPANCY_LABELS[difference.type]}</li>`)
      .join("")}</ul>`);
  }
  return parts.join("");
}

const RECEIPT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
};

/** Nombre fijo por clave: es lo que permite reconocer un remito ya adjuntado. */
export function deliveryReceiptFileName(receipt: Pick<DeliveryReceipt, "idempotencyKey" | "contentType">): string {
  const slug = receipt.idempotencyKey.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `trazflow-${slug}${RECEIPT_EXTENSIONS[receipt.contentType] ?? ""}`;
}

/* ---------- Mapeo ERPNext → contrato ---------- */

export function mapItem(item: ErpNextItem): ErpProduct {
  return {
    externalId: item.name,
    sku: item.item_code,
    name: item.item_name,
    uom: item.stock_uom,
    batchTracked: item.has_batch_no === 1,
    active: item.disabled === 0,
    updatedAt: frappeDatetimeToIso(item.modified),
  };
}

export function mapBatch(batch: ErpNextBatch): ErpLot {
  return {
    externalId: batch.name,
    productExternalId: batch.item,
    lotNumber: batch.name,
    manufacturingDate: batch.manufacturing_date || null,
    expirationDate: batch.expiry_date || null,
    active: batch.disabled === 0,
    updatedAt: frappeDatetimeToIso(batch.modified),
  };
}

export function mapWarehouse(warehouse: ErpNextWarehouse): ErpWarehouse {
  return {
    externalId: warehouse.name,
    name: warehouse.warehouse_name || warehouse.name,
    active: warehouse.disabled === 0,
    updatedAt: frappeDatetimeToIso(warehouse.modified),
  };
}

export function mapBatchQty(itemCode: string, uom: string, row: ErpNextBatchQty): ErpStockBalance {
  return {
    productExternalId: itemCode,
    lotExternalId: row.batch_no || null,
    warehouseExternalId: row.warehouse,
    quantity: row.qty,
    uom,
  };
}

export function mapSalesOrderStatus(order: Pick<ErpNextSalesOrder, "status" | "docstatus" | "per_delivered">): ErpDispatchOrderStatus {
  if (order.docstatus === 2 || order.status === "Cancelled" || order.status === "Closed") return "cancelled";
  if (OPEN_SALES_ORDER_STATUSES.includes(order.status)) {
    return order.per_delivered > 0 ? "partially_delivered" : "pending";
  }
  return "delivered";
}

export function mapSalesOrder(order: ErpNextSalesOrder): ErpDispatchOrder {
  return {
    contractVersion: ERP_CONTRACT_VERSION,
    externalId: order.name,
    status: mapSalesOrderStatus(order),
    customer: { externalId: order.customer, name: order.customer_name || order.customer },
    scheduledDate: order.delivery_date || null,
    lines: order.items.map((item) => ({
      externalId: item.name,
      productExternalId: item.item_code,
      quantity: item.stock_qty,
      uom: item.stock_uom,
      warehouseExternalId: item.warehouse || null,
    })),
    updatedAt: frappeDatetimeToIso(order.modified),
  };
}

/**
 * Remito (Delivery Note) en borrador contra la Sales Order. Queda sin enviar (docstatus 0): el ERP revisa y
 * submitea, que es lo que mueve su stock. TrazFlow solo informa qué lote y pallet salieron.
 */
export function buildDeliveryNote(report: DispatchReport, order: ErpNextSalesOrder): Record<string, unknown> {
  const posting = isoToFrappeDatetime(report.dispatchedAt);
  return {
    customer: order.customer,
    posting_date: posting.slice(0, 10),
    posting_time: posting.slice(11, 19),
    set_posting_time: 1,
    [ERPNEXT_CUSTOM_FIELDS.idempotencyKey]: report.idempotencyKey,
    [ERPNEXT_CUSTOM_FIELDS.operator]: operatorLabel(report),
    items: report.lines.map((line) => {
      // Sin línea informada se usa la primera del mismo producto; una línea informada tiene que ser de la orden.
      const orderItem = line.orderLineExternalId
        ? order.items.find((item) => item.name === line.orderLineExternalId)
        : order.items.find((item) => item.item_code === line.productExternalId);
      if (!orderItem) {
        throw validation(
          line.orderLineExternalId
            ? `La línea ${line.orderLineExternalId} no pertenece a la orden ${order.name}.`
            : `El producto ${line.productExternalId} no figura en la orden ${order.name}.`,
        );
      }
      return {
        item_code: line.productExternalId,
        qty: line.quantity,
        uom: line.uom,
        conversion_factor: 1,
        batch_no: line.lotExternalId,
        use_serial_batch_fields: 1,
        warehouse: orderItem.warehouse,
        against_sales_order: order.name,
        so_detail: orderItem.name,
        [ERPNEXT_CUSTOM_FIELDS.palletCode]: line.palletCode,
      };
    }),
  };
}

/**
 * true si el remito guardado corresponde al mismo reporte: fecha y hora, operador y, por pallet, producto, lote,
 * cantidad y unidad. Es la comparación que hace el mock con el payload completo, sobre lo que ERPNext conserva.
 */
export function deliveryNoteMatchesReport(note: ErpNextDeliveryNote, report: DispatchReport): boolean {
  const posting = isoToFrappeDatetime(report.dispatchedAt);
  const reported = report.lines.map((line) => ({
    item_code: line.productExternalId,
    qty: line.quantity,
    uom: line.uom,
    batch_no: line.lotExternalId,
    [ERPNEXT_CUSTOM_FIELDS.palletCode]: line.palletCode,
  }));
  return (
    note.posting_date === posting.slice(0, 10) &&
    normalizeFrappeTime(note.posting_time) === posting.slice(11, 19) &&
    (note[ERPNEXT_CUSTOM_FIELDS.operator] ?? "") === operatorLabel(report) &&
    linesFingerprint(note.items) === linesFingerprint(reported)
  );
}

function linesFingerprint(items: ErpNextDeliveryNote["items"]): string {
  return items
    .map((item) => [item[ERPNEXT_CUSTOM_FIELDS.palletCode] ?? "", item.item_code, item.batch_no ?? "", Number(item.qty), item.uom].join("|"))
    .sort()
    .join("\n");
}

/**
 * Estado del remito de un despacho a partir de los Delivery Notes con su clave de idempotencia. Si hay varios
 * (uno anulado y su corrección), gana el confirmado, después el borrador y por último el anulado. Ninguno:
 * not_found (en ERPNext se puede borrar un borrador).
 */
export function mapDeliveryNoteStatus(notes: ErpNextDeliveryNoteState[]): DispatchDocumentStatus {
  for (const [docstatus, status] of [[1, "confirmed"], [0, "draft"], [2, "cancelled"]] as const) {
    const note = notes.find((candidate) => candidate.docstatus === docstatus);
    if (note) return { status, erpReference: note.name };
  }
  return { status: "not_found", erpReference: null };
}

/* ---------- Cliente ---------- */

export class ErpNextClient implements ErpClient {
  readonly provider = "erpnext" as const;

  readonly #baseUrl: string;
  readonly #authorization: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: ErpNextClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#authorization = `token ${options.apiKey}:${options.apiSecret}`;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async healthcheck(): Promise<ErpHealth> {
    const started = Date.now();
    const body = await this.#request<{ message?: unknown }>("GET", "/api/method/frappe.auth.get_logged_user");
    if (typeof body.message !== "string" || !body.message || body.message === "Guest") {
      throw new ErpError("unauthorized", "ERPNext no reconoce las credenciales configuradas.");
    }
    return { provider: this.provider, ok: true, latencyMs: Date.now() - started, checkedAt: this.#now().toISOString() };
  }

  async pullMasterData(options: ErpPullOptions = {}): Promise<ErpMasterData> {
    const since = modifiedSinceFilter(options);
    const itemFields = ["name", "item_code", "item_name", "stock_uom", "has_batch_no", "disabled", "modified"];

    // Depósitos: siempre la lista completa (sin updatedSince), sin grupos e incluidos los deshabilitados, para
    // que TrazFlow marque inactivos los que el ERP deshabilitó o dejó de informar.
    const warehouses = (await this.#list<ErpNextWarehouse>(
      "Warehouse",
      ["name", "warehouse_name", "is_group", "disabled", "modified"],
      [["is_group", "=", 0]],
    )).map(mapWarehouse);
    assertValidErpWarehouses(warehouses);

    const items = await this.#list<ErpNextItem>("Item", itemFields, [["is_stock_item", "=", 1], ...since]);
    const batches = await this.#list<ErpNextBatch>(
      "Batch",
      ["name", "item", "manufacturing_date", "expiry_date", "disabled", "modified"],
      since,
    );

    // El stock se trae completo aunque haya updatedSince: es una foto, no un cambio.
    const stockItems = options.updatedSince
      ? await this.#list<ErpNextItem>("Item", itemFields, [["is_stock_item", "=", 1], ["has_batch_no", "=", 1], ["disabled", "=", 0]])
      : items.filter((item) => item.has_batch_no === 1 && item.disabled === 0);

    const stock: ErpStockBalance[] = [];
    for (const item of stockItems) {
      const rows = await this.#method<ErpNextBatchQty[]>(
        "erpnext.stock.doctype.batch.batch.get_batch_qty",
        { item_code: item.name },
      );
      if (!Array.isArray(rows)) throw invalidResponse("get_batch_qty no devolvió una lista");
      for (const row of rows) {
        if (row.qty > 0) stock.push(mapBatchQty(item.name, item.stock_uom, row));
      }
    }

    return {
      contractVersion: ERP_CONTRACT_VERSION,
      fetchedAt: this.#now().toISOString(),
      warehouses,
      products: items.map(mapItem),
      lots: batches.map(mapBatch),
      stock,
    };
  }

  async pullDispatchOrders(options: ErpPullOptions = {}): Promise<ErpDispatchOrder[]> {
    const refs = await this.#list<{ name: string }>("Sales Order", ["name"], [
      ["docstatus", "=", 1],
      ["status", "in", OPEN_SALES_ORDER_STATUSES],
      ...modifiedSinceFilter(options),
    ]);
    const orders: ErpDispatchOrder[] = [];
    for (const ref of refs) orders.push(mapSalesOrder(await this.#getSalesOrder(ref.name)));
    return orders;
  }

  async reportDispatch(report: DispatchReport): Promise<DispatchReportResult> {
    assertValidDispatchReport(report);

    const existing = await this.#findDeliveryNote(report.idempotencyKey);
    if (existing) return this.#resolveExisting(existing, report);

    let order: ErpNextSalesOrder;
    try {
      order = await this.#getSalesOrder(report.orderExternalId);
    } catch (error) {
      if (isErpError(error) && error.code === "not_found") {
        throw validation(`La orden ${report.orderExternalId} no existe en ERPNext.`);
      }
      throw error;
    }
    if (order.docstatus !== 1) throw validation(`La orden ${order.name} no está confirmada en ERPNext.`);
    if (!OPEN_SALES_ORDER_STATUSES.includes(order.status)) {
      throw validation(`La orden ${order.name} está "${order.status}" en ERPNext: no admite despachos.`);
    }
    const deliveryNote = buildDeliveryNote(report, order);

    try {
      const body = await this.#request<{ data?: { name?: unknown } }>("POST", resourcePath("Delivery Note"), deliveryNote);
      if (typeof body.data?.name !== "string") throw invalidResponse("ERPNext no devolvió el nombre del remito");
      return { erpReference: body.data.name, duplicate: false, acceptedAt: this.#now().toISOString() };
    } catch (error) {
      // Dos envíos simultáneos con la misma clave: el campo único rechaza al segundo. Frappe responde 409
      // (DuplicateEntryError) o 417 (UniqueValidationError) según dónde choque, así que se revisa en ambos casos.
      if (isErpError(error) && (error.code === "conflict" || error.code === "validation")) {
        const winner = await this.#findDeliveryNote(report.idempotencyKey);
        if (winner) return this.#resolveExisting(winner, report);
      }
      throw error;
    }
  }

  async getDispatchStatus(idempotencyKey: string): Promise<DispatchDocumentStatus> {
    assertValidIdempotencyKey(idempotencyKey);
    // A diferencia de #findDeliveryNote, incluye los anulados (docstatus 2).
    const notes = await this.#list<ErpNextDeliveryNoteState>(
      "Delivery Note",
      ["name", "docstatus"],
      [[ERPNEXT_CUSTOM_FIELDS.idempotencyKey, "=", idempotencyKey]],
      20,
    );
    const valid = notes.every((note) => typeof note?.name === "string" && note.name && [0, 1, 2].includes(note.docstatus));
    if (!valid) throw invalidResponse("Delivery Note sin nombre o con docstatus desconocido");
    return mapDeliveryNoteStatus(notes);
  }

  /**
   * TRZ-103: comentario en el Delivery Note del despacho con el resultado por pallet y, si hubo diferencias, la
   * etiqueta ERPNEXT_REVIEW_TAG. El remito no se confirma. Primero la etiqueta y después el comentario: si algo
   * falla en el medio, el reintento vuelve a poner la etiqueta (no se duplica) y recién ahí crea el comentario,
   * que es lo que marca la entrega como informada.
   */
  async reportDelivery(report: DeliveryReport): Promise<DeliveryReportResult> {
    assertValidDeliveryReport(report);
    const note = await this.#requireDispatchNote(report.dispatchIdempotencyKey);

    const existing = await this.#list<{ name: string; creation: string }>(
      "Comment",
      ["name", "creation"],
      [
        ["reference_doctype", "=", "Delivery Note"],
        ["reference_name", "=", note.name],
        ["content", "like", `%${deliveryCommentMarker(report.idempotencyKey)}%`],
      ],
      1,
    );
    if (existing[0]) return duplicateResult({ name: note.name, creation: existing[0].creation });

    if (report.needsReview) {
      await this.#request("POST", "/api/method/frappe.desk.doctype.tag.tag.add_tag", {
        tag: ERPNEXT_REVIEW_TAG,
        dt: "Delivery Note",
        dn: note.name,
      });
    }
    await this.#request("POST", resourcePath("Comment"), {
      comment_type: "Comment",
      reference_doctype: "Delivery Note",
      reference_name: note.name,
      content: buildDeliveryComment(report),
    });
    return { erpReference: note.name, duplicate: false, acceptedAt: this.#now().toISOString() };
  }

  /** TRZ-103: adjunta el remito firmado al Delivery Note del despacho, como archivo privado. */
  async attachDeliveryReceipt(receipt: DeliveryReceipt, content: Uint8Array): Promise<DeliveryReportResult> {
    assertValidDeliveryReceipt(receipt, content);
    const note = await this.#requireDispatchNote(receipt.dispatchIdempotencyKey);
    const fileName = deliveryReceiptFileName(receipt);

    const existing = await this.#list<{ name: string; creation: string }>(
      "File",
      ["name", "creation"],
      [
        ["attached_to_doctype", "=", "Delivery Note"],
        ["attached_to_name", "=", note.name],
        ["file_name", "=", fileName],
      ],
      1,
    );
    if (existing[0]) return duplicateResult({ name: note.name, creation: existing[0].creation });

    const form = new FormData();
    form.append("file", new Blob([content as Uint8Array<ArrayBuffer>], { type: receipt.contentType }), fileName);
    form.append("is_private", "1");
    form.append("doctype", "Delivery Note");
    form.append("docname", note.name);
    const body = await this.#request<{ message?: { name?: unknown } }>("POST", "/api/method/upload_file", form);
    if (typeof body.message?.name !== "string" || !body.message.name) throw invalidResponse("upload_file sin el archivo creado");
    return { erpReference: note.name, duplicate: false, acceptedAt: this.#now().toISOString() };
  }

  /** El Delivery Note que generó el despacho. Si todavía no existe, la entrega llegó antes: se reintenta. */
  async #requireDispatchNote(dispatchIdempotencyKey: string): Promise<ErpNextDeliveryNoteRef> {
    const note = await this.#findDeliveryNote(dispatchIdempotencyKey);
    if (!note) {
      throw new ErpError(
        "not_ready",
        `Todavía no hay remito en ERPNext para ${dispatchIdempotencyKey}: se reintenta cuando se informe el despacho.`,
      );
    }
    return note;
  }

  /** Misma clave y mismo contenido → duplicado; misma clave con otro contenido → conflict, como en el mock. */
  async #resolveExisting(ref: ErpNextDeliveryNoteRef, report: DispatchReport): Promise<DispatchReportResult> {
    const body = await this.#request<{ data?: ErpNextDeliveryNote }>(
      "GET",
      `${resourcePath("Delivery Note")}/${encodeURIComponent(ref.name)}`,
    );
    const note = body.data;
    if (!note || !Array.isArray(note.items)) throw invalidResponse(`Delivery Note ${ref.name} sin ítems`);
    if (!deliveryNoteMatchesReport(note, report)) {
      throw new ErpError(
        "conflict",
        `La clave ${report.idempotencyKey} ya se usó en el remito ${note.name} con otro contenido.`,
        { status: 409 },
      );
    }
    return duplicateResult(ref);
  }

  async #getSalesOrder(name: string): Promise<ErpNextSalesOrder> {
    const body = await this.#request<{ data?: ErpNextSalesOrder }>("GET", `${resourcePath("Sales Order")}/${encodeURIComponent(name)}`);
    if (!body.data || !Array.isArray(body.data.items)) throw invalidResponse(`Sales Order ${name} sin ítems`);
    return body.data;
  }

  async #findDeliveryNote(idempotencyKey: string): Promise<ErpNextDeliveryNoteRef | null> {
    const found = await this.#list<ErpNextDeliveryNoteRef>(
      "Delivery Note",
      ["name", "creation"],
      [[ERPNEXT_CUSTOM_FIELDS.idempotencyKey, "=", idempotencyKey], ["docstatus", "!=", 2]],
      1,
    );
    return found[0] ?? null;
  }

  async #list<T>(doctype: string, fields: string[], filters: Filter[], limit?: number): Promise<T[]> {
    const pageSize = limit ?? PAGE_SIZE;
    const rows: T[] = [];
    for (let start = 0; ; start += pageSize) {
      const query = new URLSearchParams({
        fields: JSON.stringify(fields),
        filters: JSON.stringify(filters),
        order_by: "creation asc",
        limit_start: String(start),
        limit_page_length: String(pageSize),
      });
      const body = await this.#request<{ data?: T[] }>("GET", `${resourcePath(doctype)}?${query}`);
      if (!Array.isArray(body.data)) throw invalidResponse(`listado de ${doctype} sin data`);
      rows.push(...body.data);
      if (limit !== undefined || body.data.length < pageSize) return rows;
    }
  }

  async #method<T>(method: string, params: Record<string, string>): Promise<T> {
    const body = await this.#request<{ message?: T }>("GET", `/api/method/${method}?${new URLSearchParams(params)}`);
    return body.message as T;
  }

  /** JSON por defecto; un FormData se manda como multipart (upload_file) y fetch arma el Content-Type. */
  async #request<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const multipart = payload instanceof FormData;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.#authorization,
          Accept: "application/json",
          ...(payload === undefined || multipart ? {} : { "Content-Type": "application/json" }),
        },
        body: payload === undefined ? undefined : multipart ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(this.#timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ErpError("timeout", `ERPNext no respondió en ${this.#timeoutMs} ms.`, { cause: error });
      }
      throw new ErpError("network", "No se pudo conectar con ERPNext.", { cause: error });
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        if (response.ok) throw invalidResponse("la respuesta no es JSON");
      }
    }

    if (!response.ok) {
      const status = response.status;
      throw new ErpError(erpErrorCodeFromStatus(status), `ERPNext respondió ${status}: ${frappeErrorMessage(body)}`, { status });
    }
    return (body ?? {}) as T;
  }
}

/* ---------- Utilidades ---------- */

function resourcePath(doctype: string): string {
  return `/api/resource/${encodeURIComponent(doctype)}`;
}

function duplicateResult(note: ErpNextDeliveryNoteRef): DispatchReportResult {
  return { erpReference: note.name, duplicate: true, acceptedAt: frappeDatetimeToIso(note.creation) };
}

function validation(message: string): ErpError {
  return new ErpError("validation", message, { status: 422 });
}

function operatorLabel(report: DispatchReport): string {
  return report.operator.name || report.operator.id;
}

/** "9:30:00" / "09:30:00.000000" → "09:30:00". */
function normalizeFrappeTime(value: string): string {
  const [hours = "0", minutes = "0", seconds = "0"] = value.trim().split(":");
  return [hours, minutes, seconds.split(".")[0]].map((part) => part.padStart(2, "0")).join(":");
}

function invalidResponse(detail: string): ErpError {
  return new ErpError("invalid_response", `Respuesta inesperada de ERPNext: ${detail}.`);
}

function modifiedSinceFilter({ updatedSince }: ErpPullOptions): Filter[] {
  if (!updatedSince) return [];
  if (Number.isNaN(Date.parse(updatedSince))) throw new ErpError("validation", "updatedSince no es una fecha ISO 8601.");
  return [["modified", ">=", isoToFrappeDatetime(updatedSince)]];
}

/** "2026-10-10 12:00:00.123456" (hora del servidor ERPNext) → ISO 8601 UTC. */
export function frappeDatetimeToIso(value: string): string {
  const [date, time = "00:00:00"] = value.trim().split(/[ T]/);
  const parsed = Date.parse(`${date}T${time.slice(0, 12)}${ERPNEXT_UTC_OFFSET}`);
  if (Number.isNaN(parsed)) throw invalidResponse(`fecha inválida "${value}"`);
  return new Date(parsed).toISOString();
}

/** ISO 8601 → "YYYY-MM-DD HH:mm:ss" en hora del servidor ERPNext. */
export function isoToFrappeDatetime(value: string): string {
  return new Date(Date.parse(value) + OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Mensaje legible de un error de Frappe, sin traza (`exc`) ni nada que no sea el texto que el ERP muestra al
 * usuario. Frappe manda `_server_messages` como string JSON con una lista de strings JSON.
 */
export function frappeErrorMessage(body: unknown): string {
  const fallback = "sin detalle";
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;

  const messages: string[] = [];
  if (typeof record._server_messages === "string") {
    try {
      for (const raw of JSON.parse(record._server_messages) as unknown[]) {
        const parsed = typeof raw === "string" ? (JSON.parse(raw) as { message?: unknown }) : raw;
        const message = (parsed as { message?: unknown })?.message;
        if (typeof message === "string") messages.push(message);
      }
    } catch {
      // Formato inesperado: se ignora y se usa lo que haya en exc_type / message.
    }
  }
  if (!messages.length && typeof record.message === "string") messages.push(record.message);
  if (!messages.length && typeof record.exc_type === "string") messages.push(record.exc_type);

  const text = messages
    .join(" | ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE - 1)}…` : text;
}
