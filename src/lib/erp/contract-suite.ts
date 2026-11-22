import "server-only";
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { ErpClient } from "./client";
import { ERP_CONTRACT_VERSION, ErpError, type DispatchReport, type StockEntryReport, type PalletScanReport } from "./types";
import { mapErpUnit } from "../erp-sync/units";

export type ContractFailure = "401" | "403" | "timeout" | "network";
type Capability = true | string;
export type ContractOptions = {
  supports?: Partial<Record<"dispatch" | "stockEntry" | "palletScan" | "deliveryNotReady", Capability>>;
  errors?: Partial<Record<ContractFailure, (() => ErpClient) | string>>;
  secrets?: string[];
};

function assertDate(value: string | null) {
  if (value === null) return;
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  const parsed = new Date(`${value}T00:00:00Z`);
  assert.ok(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, `Fecha inválida: ${value}`);
}

/** Solo infraestructura de tests: cada fábrica debe devolver un cliente y estado nuevos. */
export function runErpClientContract(name: string, makeClient: () => ErpClient, options: ContractOptions = {}): void {
  describe(`contrato ERP: ${name}`, () => {
    const capabilityTest = (capability: keyof NonNullable<ContractOptions["supports"]>, title: string, run: () => Promise<void>) => {
      const support = options.supports?.[capability];
      test(title + (typeof support === "string" ? ` — no soportado por ${name}: ${support}` : ""), { skip: typeof support === "string" }, run);
    };
    test("versión, relaciones, fechas, unidades e ids estables", async () => {
      const client = makeClient();
      const data = await client.pullMasterData();
      assert.equal(data.contractVersion, ERP_CONTRACT_VERSION);
      // Un fixture vacío no demuestra relaciones ni mapeos.
      for (const values of [data.products, data.lots, data.warehouses, data.stock]) assert.ok(values.length > 0);
      const products = new Set(data.products.map(item => item.externalId));
      const lots = new Set(data.lots.map(item => item.externalId));
      const warehouses = new Set(data.warehouses.map(item => item.externalId));
      for (const lot of data.lots) {
        assert.ok(products.has(lot.productExternalId));
        assertDate(lot.expirationDate); assertDate(lot.manufacturingDate);
      }
      for (const item of data.stock) {
        assert.ok(products.has(item.productExternalId));
        assert.ok(warehouses.has(item.warehouseExternalId));
        if (item.lotExternalId !== null) assert.ok(lots.has(item.lotExternalId));
        assert.ok(mapErpUnit(item.uom));
      }
      for (const product of data.products) assert.ok(mapErpUnit(product.uom));
      const next = await client.pullMasterData();
      for (const key of ["products", "lots", "warehouses"] as const) {
        const ids = data[key].map(item => item.externalId).sort();
        assert.ok(ids.every(id => id.trim().length > 0));
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual(next[key].map(item => item.externalId).sort(), ids);
      }
    });
    test("updatedSince conserva el catálogo completo de depósitos", async () => {
      const client = makeClient();
      const full = await client.pullMasterData();
      const incremental = await client.pullMasterData({ updatedSince: "2099-01-01T00:00:00Z" });
      assert.deepEqual(incremental.warehouses, full.warehouses);
    });
    test("healthcheck OK informa el proveedor del cliente", async () => {
      const client = makeClient();
      const result = await client.healthcheck();
      assert.equal(result.ok, true); assert.equal(result.provider, client.provider);
    });
    for (const failure of ["401", "403", "timeout", "network"] as const) {
      const factory = options.errors?.[failure];
      const reason = typeof factory === "string" ? factory : !factory ? "falta fábrica de fallos" : "";
      test(`error ${failure}${reason ? ` — no soportado por ${name}: ${reason}` : ""}`, { skip: Boolean(reason) }, async () => {
        assert.equal(typeof factory, "function");
        const client = (factory as () => ErpClient)();
        await assert.rejects(client.healthcheck(), (error: unknown) => {
          assert.ok(error instanceof ErpError);
          assert.equal(error.code, failure === "401" || failure === "403" ? "unauthorized" : failure);
          assert.equal(error.retryable, failure === "timeout" || failure === "network");
          for (const secret of options.secrets ?? []) assert.ok(!error.message.includes(secret));
          return true;
        });
      });
    }

    const inputs = async (client: ErpClient) => {
      const order = (await client.pullDispatchOrders())[0];
      assert.ok(order?.lines.length);
      const line = order.lines[0];
      assert.ok(line.warehouseExternalId);
      const data = await client.pullMasterData();
      const lot = data.lots.find(lot => lot.productExternalId === line.productExternalId);
      assert.ok(lot);
      const at = "2026-11-22T12:00:00Z";
      const dispatch: DispatchReport = { contractVersion: ERP_CONTRACT_VERSION, idempotencyKey: `dispatch:${order.externalId}`, orderExternalId: order.externalId,
        dispatchedAt: at, operator: { id: "contract-user", name: "Contrato" }, lines: [{ orderLineExternalId: line.externalId,
          palletCode: "PAL-CONTRACT", productExternalId: line.productExternalId, lotExternalId: lot.externalId, quantity: 1, uom: line.uom }] };
      const stock: StockEntryReport = { contractVersion: ERP_CONTRACT_VERSION, idempotencyKey: "stock-entry:contract", entryType: "receipt", productExternalId: line.productExternalId,
        lotExternalId: lot.externalId, warehouseExternalId: line.warehouseExternalId, quantity: 1, uom: line.uom, reason: "Contrato", requestedAt: at, requestedBy: dispatch.operator };
      const scan: PalletScanReport = { contractVersion: ERP_CONTRACT_VERSION, idempotencyKey: `pallet-scan:${order.externalId}:PAL-CONTRACT:1`,
        scanIdempotencyKey: `pallet-scan:${order.externalId}:PAL-CONTRACT:1`, action: "scan", orderExternalId: order.externalId,
        palletCode: "PAL-CONTRACT", productExternalId: line.productExternalId, lotExternalId: lot.externalId, quantity: 1, uom: line.uom, at };
      return { dispatch, stock, scan };
    };
    for (const [capability, method, input] of [
      ["dispatch", "reportDispatch", "dispatch"], ["stockEntry", "reportStockEntry", "stock"], ["palletScan", "reportPalletScan", "scan"],
    ] as const) capabilityTest(capability, `${method}: misma clave devuelve duplicate y misma referencia`, async () => {
      const client = makeClient();
      const payloads = await inputs(client);
      const send = () => method === "reportDispatch" ? client.reportDispatch(payloads.dispatch)
        : method === "reportStockEntry" ? client.reportStockEntry(payloads.stock) : client.reportPalletScan(payloads.scan);
      // La selección es común; ningún adaptador tiene aserciones propias.
      assert.ok(payloads[input]);
      const first = await send(); const second = await send();
      assert.equal(first.duplicate, false); assert.equal(second.duplicate, true);
      assert.ok(first.erpReference); assert.equal(second.erpReference, first.erpReference);
    });
    capabilityTest("deliveryNotReady", "entrega anterior al despacho devuelve not_ready reintentable", async () => {
      const client = makeClient(); const { dispatch } = await inputs(client);
      await assert.rejects(client.reportDelivery({ contractVersion: ERP_CONTRACT_VERSION, idempotencyKey: `delivery:${dispatch.orderExternalId}`,
        orderExternalId: dispatch.orderExternalId, dispatchIdempotencyKey: dispatch.idempotencyKey, deliveredAt: dispatch.dispatchedAt,
        driver: { id: "contract-driver", name: "Chofer" }, needsReview: false, lines: [{ palletCode: "PAL-CONTRACT", outcome: "delivered" }], discrepancies: [] }),
      (error: unknown) => error instanceof ErpError && error.code === "not_ready" && error.retryable);
    });
  });
}
