import assert from "node:assert/strict";
import { test } from "node:test";

import type { ErpClient } from "../erp/client.ts";
import { MockErpClient } from "../erp/mock-client.ts";
import { ErpError, type DispatchReport } from "../erp/types.ts";
import {
  ErpOutboxClaimError,
  processErpOutbox,
  safeLogFields,
  type ErpOutboxDb,
  type ErpOutboxLogFields,
  type ErpOutboxLogger,
} from "./processor.ts";

/* ---------- Base falsa: imita las RPC de 20261019140000_erp_dispatch_outbox.sql ---------- */

type FakeEvent = {
  id: string;
  idempotency_key: string;
  payload: unknown;
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number;
  due: boolean;
  last_error_code: string | null;
  last_error: string | null;
  erp_reference: string | null;
  erp_duplicate: boolean | null;
};

const MAX_ATTEMPTS = 10;

function fakeDb(options: { claimError?: string; failMarkSentOnce?: boolean } = {}) {
  const events = new Map<string, FakeEvent>();
  const calls: string[] = [];
  let failMarkSent = options.failMarkSentOnce ?? false;

  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      calls.push(fn);
      if (fn === "erp_outbox_claim") {
        if (options.claimError) return { data: null, error: { message: "denied", code: options.claimError } };
        const claimed = [...events.values()]
          .filter((event) => event.due && (event.status === "pending" || event.status === "processing"))
          .filter((event) => !args.p_aggregate_id || event.id === args.p_aggregate_id)
          .slice(0, Number(args.p_limit));
        for (const event of claimed) {
          event.status = "processing";
          event.attempts += 1;
        }
        return {
          data: claimed.map(({ id, idempotency_key, payload, attempts }) => ({
            id, idempotency_key, payload: structuredClone(payload), attempts,
          })),
          error: null,
        };
      }
      const event = events.get(String(args.p_event_id));
      const current = event && event.status === "processing" && event.attempts === args.p_attempt;
      if (fn === "erp_outbox_mark_sent") {
        if (failMarkSent) {
          failMarkSent = false;
          return { data: null, error: { message: "connection lost", code: "08006" } };
        }
        if (!current) return { data: false, error: null };
        Object.assign(event, {
          status: "sent", due: false, erp_reference: args.p_erp_reference, erp_duplicate: args.p_duplicate,
          last_error: null, last_error_code: null,
        });
        return { data: true, error: null };
      }
      if (fn === "erp_outbox_mark_failed") {
        if (!current) return { data: null, error: null };
        const retry = args.p_retryable === true && event.attempts < MAX_ATTEMPTS;
        Object.assign(event, {
          status: retry ? "pending" : "failed",
          due: false, // el backoff deja el próximo intento en el futuro
          last_error_code: args.p_error_code,
          last_error: args.p_error_message,
        });
        return { data: event.status, error: null };
      }
      throw new Error(`RPC inesperada ${fn}`);
    },
  };

  return {
    db,
    calls,
    events,
    add(id: string, payload: unknown, idempotencyKey = (payload as DispatchReport).idempotencyKey) {
      events.set(id, {
        id, idempotency_key: idempotencyKey, payload, status: "pending", attempts: 0, due: true,
        last_error_code: null, last_error: null, erp_reference: null, erp_duplicate: null,
      });
    },
    /** Simula que pasó el backoff o que venció el lease. */
    makeDue(id: string) {
      events.get(id)!.due = true;
    },
  };
}

/** Payload tal como lo arma confirm_dispatch_order contra los fixtures del mock. */
function report(overrides: Partial<DispatchReport> = {}): DispatchReport {
  return {
    contractVersion: 1,
    idempotencyKey: "dispatch:SAL-ORD-2026-00012",
    orderExternalId: "SAL-ORD-2026-00012",
    dispatchedAt: "2026-10-19T14:30:00.000Z",
    operator: { id: "5d0c0000-0000-0000-0000-000000000001", name: "Operadora Confidencial" },
    lines: [
      { orderLineExternalId: null, palletCode: "PAL-0001", productExternalId: "ACE-500", lotExternalId: "L-2026-0915", quantity: 45, uom: "Caja" },
      { orderLineExternalId: null, palletCode: "PAL-0002", productExternalId: "ACE-500", lotExternalId: "L-2026-0921", quantity: 20, uom: "Caja" },
    ],
    ...overrides,
  };
}

/** Cliente que registra lo que recibe y delega en el mock. */
function spyClient(inner: ErpClient = new MockErpClient()) {
  const received: DispatchReport[] = [];
  const client: ErpClient = {
    provider: inner.provider,
    healthcheck: () => inner.healthcheck(),
    pullMasterData: (options) => inner.pullMasterData(options),
    pullDispatchOrders: (options) => inner.pullDispatchOrders(options),
    reportDispatch: (sent) => {
      received.push(structuredClone(sent));
      return inner.reportDispatch(sent);
    },
    getDispatchStatus: (key) => inner.getDispatchStatus(key),
    reportDelivery: (report) => inner.reportDelivery(report),
    attachDeliveryReceipt: (receipt, content) => inner.attachDeliveryReceipt(receipt, content),
  };
  return { client, received };
}

/** Mock con otro reportDispatch (colgado, roto...). */
function clientWith(reportDispatch: ErpClient["reportDispatch"]): ErpClient {
  return Object.assign(new MockErpClient(), { reportDispatch });
}

function memoryLogger() {
  const lines: string[] = [];
  const write = (event: string, fields: ErpOutboxLogFields) => lines.push(`${event} ${JSON.stringify(safeLogFields(fields))}`);
  const logger: ErpOutboxLogger = { info: write, warn: write, error: write };
  return { logger, lines };
}

const quiet = memoryLogger().logger;

/* ---------- Casos ---------- */

test("envía el payload guardado y marca el evento como enviado", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  const { client, received } = spyClient();

  const summary = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });

  assert.deepEqual(summary, { claimed: 1, sent: 1, duplicates: 0, retrying: 0, failed: 0, unrecorded: 0 });
  assert.deepEqual(received, [report()]);
  assert.equal(fake.events.get("ev-1")!.status, "sent");
  assert.equal(fake.events.get("ev-1")!.erp_reference, "MOCK-DN-0001");
  assert.deepEqual(fake.calls, ["erp_outbox_claim", "erp_outbox_mark_sent"]);
});

test("sin eventos pendientes no crea el cliente ERP", async () => {
  const fake = fakeDb();
  let created = false;
  const summary = await processErpOutbox({
    db: fake.db,
    getClient: () => { created = true; return new MockErpClient(); },
    logger: quiet,
  });
  assert.equal(summary.claimed, 0);
  assert.equal(created, false);
});

test("timeout del ERP: queda pendiente y el reintento conserva payload y clave", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  const { client, received } = spyClient(new MockErpClient({ failures: ["timeout"] }));

  const first = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.equal(first.retrying, 1);
  assert.equal(fake.events.get("ev-1")!.status, "pending");
  assert.equal(fake.events.get("ev-1")!.last_error_code, "timeout");

  // Antes del backoff no se reintenta.
  const early = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.equal(early.claimed, 0);

  fake.makeDue("ev-1");
  const second = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.equal(second.sent, 1);
  assert.equal(received.length, 2);
  assert.deepEqual(received[0], received[1]);
  assert.equal(received[1].idempotencyKey, "dispatch:SAL-ORD-2026-00012");
  assert.equal(fake.events.get("ev-1")!.attempts, 2);
});

test("un ERP que no responde se corta con el timeout del procesador", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  const hanging = clientWith(() => new Promise(() => {}));

  const summary = await processErpOutbox({ db: fake.db, getClient: () => hanging, timeoutMs: 20, logger: quiet });

  assert.equal(summary.retrying, 1);
  assert.equal(fake.events.get("ev-1")!.last_error_code, "timeout");
});

test("5xx, red y 429 se reintentan; agotados los intentos pasa a failed", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  const client = new MockErpClient({ scenario: "server_error" });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    fake.makeDue("ev-1");
    await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  }
  const event = fake.events.get("ev-1")!;
  assert.equal(event.status, "failed");
  assert.equal(event.attempts, MAX_ATTEMPTS);
  assert.equal(event.last_error_code, "unavailable");
});

test("error permanente (422): failed sin reintentos", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());

  const summary = await processErpOutbox({
    db: fake.db, getClient: () => new MockErpClient({ scenario: "validation" }), logger: quiet,
  });

  assert.equal(summary.failed, 1);
  const event = fake.events.get("ev-1")!;
  assert.equal(event.status, "failed");
  assert.equal(event.last_error_code, "validation");
  fake.makeDue("ev-1");
  assert.equal((await processErpOutbox({ db: fake.db, getClient: () => new MockErpClient(), logger: quiet })).claimed, 0);
});

test("401 y configuración inválida requieren atención", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  fake.add("ev-2", report({ idempotencyKey: "dispatch:SAL-ORD-2026-00013", orderExternalId: "SAL-ORD-2026-00013" }));

  await processErpOutbox({ db: fake.db, getClient: () => new MockErpClient({ scenario: "unauthorized" }), limit: 1, logger: quiet });
  assert.equal(fake.events.get("ev-1")!.status, "failed");
  assert.equal(fake.events.get("ev-1")!.last_error_code, "unauthorized");

  await processErpOutbox({
    db: fake.db,
    getClient: () => { throw new ErpError("config", "Faltan variables de entorno del ERP: ERP_API_KEY."); },
    logger: quiet,
  });
  assert.equal(fake.events.get("ev-2")!.status, "failed");
  assert.equal(fake.events.get("ev-2")!.last_error_code, "config");
});

test("duplicado: si el ERP ya lo registró, cuenta como enviado y no genera otra salida", async () => {
  const fake = fakeDb({ failMarkSentOnce: true });
  fake.add("ev-1", report());
  const { client, received } = spyClient();

  // El ERP aceptó, pero no se pudo guardar el resultado: el evento queda en proceso hasta que venza el lease.
  const first = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.equal(first.unrecorded, 1);
  assert.equal(fake.events.get("ev-1")!.status, "processing");

  fake.makeDue("ev-1");
  const second = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });
  assert.deepEqual(second, { claimed: 1, sent: 1, duplicates: 1, retrying: 0, failed: 0, unrecorded: 0 });
  assert.equal(fake.events.get("ev-1")!.erp_reference, "MOCK-DN-0001");
  assert.equal(fake.events.get("ev-1")!.erp_duplicate, true);
  assert.equal(received.length, 2);
});

test("misma clave con otro contenido: conflict, sin reintentos", async () => {
  const fake = fakeDb();
  const erp = new MockErpClient();
  await erp.reportDispatch(report());
  fake.add("ev-1", report({ dispatchedAt: "2026-10-19T15:00:00.000Z" }));

  await processErpOutbox({ db: fake.db, getClient: () => erp, logger: quiet });

  assert.equal(fake.events.get("ev-1")!.status, "failed");
  assert.equal(fake.events.get("ev-1")!.last_error_code, "conflict");
});

test("un payload incompleto no llega al ERP", async () => {
  const fake = fakeDb();
  const incomplete = report();
  incomplete.lines[0] = { ...incomplete.lines[0], lotExternalId: null as unknown as string };
  fake.add("ev-1", incomplete);
  fake.add("ev-2", report(), "dispatch:OTRA-CLAVE");
  const { client, received } = spyClient();

  const summary = await processErpOutbox({ db: fake.db, getClient: () => client, logger: quiet });

  assert.equal(summary.failed, 2);
  assert.equal(received.length, 0);
  assert.match(fake.events.get("ev-1")!.last_error!, /lotExternalId es obligatorio/);
  assert.match(fake.events.get("ev-2")!.last_error!, /clave de idempotencia/);
});

test("un error inesperado se reintenta con un mensaje genérico", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  const broken = clientWith(() => Promise.reject(new Error("ECONNRESET token=supersecreto123 Authorization: token abc:def")));

  const summary = await processErpOutbox({ db: fake.db, getClient: () => broken, logger: quiet });

  assert.equal(summary.retrying, 1);
  assert.equal(fake.events.get("ev-1")!.last_error_code, "unknown");
  assert.equal(fake.events.get("ev-1")!.last_error, "Error inesperado al reportar el despacho al ERP.");
});

test("el log no trae payload ni secretos", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  fake.add("ev-2", report({ idempotencyKey: "dispatch:SAL-ORD-2026-00099", orderExternalId: "SAL-ORD-2026-00099" }));
  const { logger, lines } = memoryLogger();
  let calls = 0;
  const client = clientWith((sent) => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error("api_secret=supersecreto123"));
    return new MockErpClient().reportDispatch(sent);
  });

  await processErpOutbox({ db: fake.db, getClient: () => client, logger });

  const output = lines.join("\n");
  assert.ok(lines.length >= 3, output);
  assert.doesNotMatch(output, /supersecreto123|api_secret/);
  assert.doesNotMatch(output, /Operadora Confidencial|PAL-0001|L-2026-0915/);
  assert.match(output, /retry_scheduled/);
  assert.match(output, /"eventId":"ev-1"/);
});

test("safeLogFields descarta lo que no está en la lista", () => {
  const fields = { eventId: "ev-1", payload: { secret: true }, apiSecret: "x" } as unknown as ErpOutboxLogFields;
  assert.deepEqual(safeLogFields(fields), { eventId: "ev-1" });
});

test("si no se pueden tomar eventos falla sin llamar al ERP", async () => {
  const fake = fakeDb({ claimError: "42501" });
  let created = false;
  await assert.rejects(
    processErpOutbox({ db: fake.db, getClient: () => { created = true; return new MockErpClient(); }, logger: quiet }),
    (error: unknown) => error instanceof ErpOutboxClaimError && error.code === "42501" && /permisos/.test(error.message),
  );
  assert.equal(created, false);
});

test("filtra por orden cuando se procesa justo después de confirmar", async () => {
  const fake = fakeDb();
  fake.add("ev-1", report());
  fake.add("ev-2", report({ idempotencyKey: "dispatch:SAL-ORD-2026-00099", orderExternalId: "SAL-ORD-2026-00099" }));

  const summary = await processErpOutbox({ db: fake.db, getClient: () => new MockErpClient(), aggregateId: "ev-1", logger: quiet });

  assert.equal(summary.claimed, 1);
  assert.equal(fake.events.get("ev-2")!.status, "pending");
});
