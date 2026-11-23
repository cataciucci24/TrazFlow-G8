import { ErpNextClient, ERPNEXT_CUSTOM_FIELDS } from "../../src/lib/erp/erpnext-client";
import { MOCK_ERP_FIXTURES } from "../../src/lib/erp/fixtures";
import type { ContractFailure } from "../../src/lib/erp/contract-suite";

export const CONTRACT_SECRETS = ["contract-api-key", "contract-api-secret"];
const modified = "2026-10-01 09:00:00";
type Doc = Record<string, unknown>;

/** Simula persistencia y filtros HTTP, sin invocar mapeos del adaptador bajo prueba. */
export function makeErpNextContractClient(failure?: ContractFailure) {
  const f = structuredClone(MOCK_ERP_FIXTURES);
  const store: Record<string, Doc[]> = {
    Warehouse: f.warehouses.map(w => ({ name: w.externalId, warehouse_name: w.name, is_group: 0, disabled: w.active ? 0 : 1, modified, company: "Contract Company" })),
    Item: f.products.map(p => ({ name: p.externalId, item_code: p.sku, item_name: p.name, stock_uom: p.uom, has_batch_no: p.batchTracked ? 1 : 0, disabled: p.active ? 0 : 1, modified, is_stock_item: 1 })),
    Batch: f.lots.map(l => ({ name: l.externalId, item: l.productExternalId, manufacturing_date: l.manufacturingDate, expiry_date: l.expirationDate, disabled: l.active ? 0 : 1, modified })),
    "Sales Order": f.orders.filter(o => o.status === "pending").map(o => ({ name: o.externalId, company: "Contract Company", customer: o.customer.externalId, customer_name: o.customer.name,
      delivery_date: o.scheduledDate, status: "To Deliver and Bill", docstatus: 1, per_delivered: 0, modified,
      items: o.lines.map(l => ({ name: l.externalId, item_code: l.productExternalId, stock_qty: l.quantity, stock_uom: l.uom, warehouse: l.warehouseExternalId })) })),
    "Delivery Note": [], "Stock Entry": [], "Pick List": [], Comment: [],
  };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    if (failure === "timeout") throw new DOMException("request timed out", "TimeoutError");
    if (failure === "network") throw new TypeError(`connection failed: ${CONTRACT_SECRETS.join(":")}`);
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (failure === "401" || failure === "403") return respond({ exc_type: "AuthenticationError" }, Number(failure));
    const url = new URL(String(input)); const path = decodeURIComponent(url.pathname);
    if (path === "/api/method/frappe.auth.get_logged_user") return respond({ message: "contract@example.test" });
    if (path === "/api/method/erpnext.stock.doctype.batch.batch.get_batch_qty") {
      return respond({ message: f.stock.filter(s => s.productExternalId === url.searchParams.get("item_code")).map(s => ({ batch_no: s.lotExternalId, warehouse: s.warehouseExternalId, qty: s.quantity })) });
    }
    if (!path.startsWith("/api/resource/")) throw new Error(`Ruta no implementada: ${path}`);
    const resource = path.slice("/api/resource/".length);
    // Los nombres de documentos pueden incluir barras; primero se identifica el tipo.
    const type = Object.keys(store).find(type => resource === type || resource.startsWith(type + "/"));
    if (!type) throw new Error(`Tipo no implementado: ${resource}`);
    const name = resource === type ? null : resource.slice(type.length + 1);
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as Doc;
      const doc = { ...body, name: `${type}-CONTRACT-${store[type].length + 1}`, creation: modified, docstatus: 0 };
      store[type].push(doc); return respond({ data: doc });
    }
    if (name) {
      const doc = store[type].find(doc => doc.name === name);
      return respond(doc ? { data: doc } : { exc_type: "DoesNotExistError" }, doc ? 200 : 404);
    }
    const filters = JSON.parse(url.searchParams.get("filters") ?? "[]") as [string, string, unknown][];
    const docs = store[type].filter(doc => filters.every(([field, op, value]) => {
      if (op === "=") return doc[field] === value;
      if (op === "!=") return doc[field] !== value;
      if (op === "in") return Array.isArray(value) && value.includes(doc[field]);
      if (op === ">=") return String(doc[field]) >= String(value);
      throw new Error(`Filtro no implementado: ${field} ${op}`);
    }));
    const offset = Number(url.searchParams.get("limit_start") ?? 0);
    const count = Number(url.searchParams.get("limit_page_length") ?? docs.length);
    return respond({ data: docs.slice(offset, offset + count) });
  };
  // Este chequeo detecta cambios de nombres en el contrato de campos, sin copiar el builder de documentos.
  if (!ERPNEXT_CUSTOM_FIELDS.idempotencyKey) throw new Error("Falta campo de idempotencia");
  return new ErpNextClient({ baseUrl: "https://contract.example.test", apiKey: CONTRACT_SECRETS[0], apiSecret: CONTRACT_SECRETS[1], timeoutMs: 1000, fetch: fetchImpl });
}
