import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { MockErpClient } from "../erp/mock-client.ts";
import type { MockErpFixtures } from "../erp/fixtures.ts";
import type { DeliveryReport, DispatchReport } from "../erp/types.ts";
import { buildDeliveryComment } from "../erp/erpnext-client.ts";
import { processErpOutbox, type ErpOutboxDb } from "../erp-outbox/processor.ts";

// Opt-in: usa exclusivamente el contenedor local, nunca URLs/credenciales remotas.
// TRAZFLOW_SQL_INTEGRATION=1 npx vitest run src/lib/pallets/erp-v2-integration.test.ts
test.skipIf(process.env.TRAZFLOW_SQL_INTEGRATION !== "1")("productores SQL → outbox por empresa → adaptador v2 y replay v1", async () => {
  const config = readFileSync("supabase/config.toml", "utf8");
  const project = /^project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(config)?.[1];
  assert.ok(project);
  const result = spawnSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], {
    input: readFileSync("supabase/tests/trz111_erp_v2_delivery.sql", "utf8"), encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const exported = (prefix: string) => {
    const row = result.stdout.split(/\r?\n/).find((line) => line.startsWith(prefix));
    assert.ok(row, `Falta ${prefix}`);
    return JSON.parse(row.slice(prefix.length));
  };
  type Event = { id: string; company_id: string; idempotency_key: string; payload: Record<string, unknown>; attempts: number };
  const events: Event[] = exported("TRZ111_EVENTS=");
  const incomplete: DeliveryReport = exported("TRZ111_INCOMPLETE=");
  assert.ok(events.some((event) => event.payload.contractVersion === 1));
  assert.equal(new Set(events.map((event) => event.company_id)).size, 2);
  const original = structuredClone(events);
  const clients = new Map<string, MockErpClient>();
  const catalogs = new Map<string, MockErpFixtures>();
  const sent = new Set<string>();
  let claims = 0;
  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      if (fn === "erp_outbox_claim") { claims++; return { data: structuredClone(events), error: null }; }
      assert.equal(fn, "erp_outbox_mark_sent", JSON.stringify(args));
      assert.ok(events.some((event) => event.id === args.p_event_id));
      sent.add(String(args.p_event_id));
      return { data: true, error: null };
    },
    storage: { from: (bucket) => {
      assert.equal(bucket, "delivery-receipts");
      return { download: async () => ({ data: new Blob([new Uint8Array(4)], { type: "image/jpeg" }), error: null }) };
    } },
  };
  const params = {
    db,
    getClient: (companyId: string) => {
      let client = clients.get(companyId);
      if (!client) {
        // Catálogo de cada ERP, conservando las identidades congeladas del despacho.
        const reports = events.filter((event) => event.company_id === companyId && event.idempotency_key.startsWith("dispatch:"))
          .map((event) => event.payload as unknown as DispatchReport);
        const at = "2026-11-24T12:00:00Z";
        const fixtures: MockErpFixtures = {
          warehouses: [], stock: [],
          products: reports.flatMap((report) => report.lines.map((line) => ({ externalId: line.productExternalId, sku: line.productExternalId,
            name: line.productExternalId, uom: line.uom, batchTracked: true, active: true, updatedAt: at }))),
          lots: reports.flatMap((report) => report.lines.map((line) => ({ externalId: line.lotExternalId, productExternalId: line.productExternalId,
            lotNumber: line.lotExternalId, manufacturingDate: null, expirationDate: null, active: true, updatedAt: at }))),
          orders: reports.map((report) => ({ contractVersion: report.contractVersion, externalId: report.orderExternalId, status: "pending",
            customer: { externalId: "DEST", name: "Destino" }, scheduledDate: null, updatedAt: at,
            lines: report.lines.map((line, index) => ({ externalId: line.orderLineExternalId ?? `LINE-${index}`, productExternalId: line.productExternalId,
              quantity: line.quantity, uom: line.uom, warehouseExternalId: null })) })),
        };
        catalogs.set(companyId, fixtures);
        client = new MockErpClient({ fixtures });
        clients.set(companyId, client);
      }
      return client;
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  const first = await processErpOutbox(params);
  assert.equal(first.sent, events.length, JSON.stringify(first));
  assert.equal(sent.size, events.length);
  assert.equal(clients.size, 2);
  const replay = await processErpOutbox(params);
  assert.equal(replay.sent, events.length);
  assert.equal(replay.duplicates, events.length);
  assert.equal(claims, 2);
  assert.deepEqual(events, original, "El procesador no reescribe v1 ni v2");
  // El mismo reporte con observaciones incompletas se prueba en otro ERP aislado.
  const company = events.find((event) => event.idempotency_key === incomplete.idempotencyKey)!.company_id;
  const dispatch = events.find((event) => event.company_id === company && event.idempotency_key === incomplete.dispatchIdempotencyKey)!;
  const fresh = new MockErpClient({ fixtures: catalogs.get(company)! });
  await fresh.reportDispatch(dispatch.payload as unknown as DispatchReport);
  assert.equal((await fresh.reportDelivery(incomplete)).duplicate, false);
  assert.equal((await fresh.reportDelivery(incomplete)).duplicate, true);
  assert.match(buildDeliveryComment(incomplete), /cantidad desconocida/);
  assert.match(buildDeliveryComment(incomplete), /unidad desconocida/);
}, 90_000);
