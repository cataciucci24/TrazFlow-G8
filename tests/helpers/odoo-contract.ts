import { OdooClient } from "../../src/lib/erp/odoo-client";
import type { ContractFailure } from "../../src/lib/erp/contract-suite";

export const ODOO_CONTRACT_KEY = "contract-odoo-api-key";

/** Respuestas externas de Odoo; la suite prueba el mapeo del adaptador real. */
export function makeOdooContractClient(failure?: ContractFailure) {
  const records: Record<string, Record<string, unknown>[]> = {
    "stock.warehouse": [
      { id: 1, name: "Central", active: true, write_date: "2026-11-01 12:00:00" },
      { id: 2, name: "Norte", active: false, write_date: "2026-11-02 12:00:00" },
    ],
    "product.product": [{ id: 10, default_code: "ACE-500", name: "Aceite", uom_id: [1, "Units"], tracking: "lot", active: true, write_date: "2026-11-01 12:00:00" }],
    "stock.lot": [{ id: 100, name: "L-1", product_id: [10, "Aceite"], expiration_date: "2027-12-31 03:00:00", write_date: "2026-11-01 12:00:00" }],
    "stock.quant": [{ id: 1000, product_id: [10, "Aceite"], lot_id: [100, "L-1"], warehouse_id: [1, "Central"], quantity: 12, product_uom_id: [1, "Units"] }],
  };
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (failure === "timeout") throw new DOMException("request timed out", "TimeoutError");
    if (failure === "network") throw new TypeError(`connection failed: ${ODOO_CONTRACT_KEY}`);
    if (failure === "401" || failure === "403") return new Response("Denied", { status: Number(failure) });
    const body = JSON.parse(String(init?.body)) as { id: number; params: { service: string; method: string; args: unknown[] } };
    const { service, method, args } = body.params;
    let result: unknown;
    if (service === "common" && method === "version") result = { server_version: "19.0" };
    else if (service === "common" && method === "authenticate") result = 2;
    else if (service === "object" && method === "execute_kw") {
      const model = String(args[3]), operation = args[4];
      if (operation === "fields_get" && model === "stock.lot") result = { expiration_date: { type: "datetime" } };
      else if (operation === "search_read" && records[model]) {
        const kwargs = args[6] as { offset: number; limit: number; fields: string[]; domain: Array<[string, string, string]> };
        const domain = kwargs.domain;
        const filtered = records[model].filter(row => domain.every(([field, op, value]) => field !== "write_date" || op !== ">=" || String(row.write_date) >= value));
        result = filtered.slice(kwargs.offset, kwargs.offset + kwargs.limit).map(row => Object.fromEntries(kwargs.fields.filter(field => field in row).map(field => [field, row[field]])));
      } else throw new Error(`Operación no simulada: ${model}.${String(operation)}`);
    } else throw new Error(`RPC no simulada: ${service}.${method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  };
  return new OdooClient({ baseUrl: "https://odoo.contract.test", database: "contract", username: "contract@example.test", apiKey: ODOO_CONTRACT_KEY, timeoutMs: 1000 }, { fetch: fetchImpl });
}
