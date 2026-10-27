import assert from "node:assert/strict";
import { test } from "node:test";

import { MockErpClient } from "../erp/mock-client.ts";
import { ErpError, type DispatchDocumentStatus } from "../erp/types.ts";
import { checkErpDispatchDocuments } from "./dispatch-documents.ts";
import type { ErpOutboxDb } from "./processor.ts";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(options: { due?: unknown; dueError?: string; recordResult?: unknown } = {}) {
  const calls: Call[] = [];
  const db: ErpOutboxDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === "erp_outbox_dispatch_documents_due") {
        return options.dueError
          ? { data: null, error: { message: "denied", code: options.dueError } }
          : { data: options.due ?? [], error: null };
      }
      if (fn === "erp_outbox_record_dispatch_document") return { data: options.recordResult ?? true, error: null };
      throw new Error(`RPC inesperada ${fn}`);
    },
  };
  return { db, calls };
}

const event = (n: number) => ({ id: `event-${n}`, idempotency_key: `dispatch:SO-${n}`, erp_reference: null, erp_document_status: null });

/** Cliente que responde por clave lo que diga `answers` (un valor o un error). */
function clientAnswering(answers: Record<string, DispatchDocumentStatus | Error>) {
  const asked: string[] = [];
  const client = new MockErpClient();
  client.getDispatchStatus = async (key) => {
    asked.push(key);
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { client, asked };
}

test("sin reportes para consultar no se crea el cliente ni se llama al ERP", async () => {
  const { db, calls } = fakeDb();
  let created = false;
  const result = await checkErpDispatchDocuments({ db, companyId: "company-1", getClient: () => { created = true; return new MockErpClient(); } });
  assert.equal(created, false);
  assert.deepEqual(calls, [{ fn: "erp_outbox_dispatch_documents_due", args: { p_company_id: "company-1", p_limit: 20 } }]);
  assert.deepEqual(result, { counters: { received: 0, draft: 0, confirmed: 0, cancelled: 0, not_found: 0, failed: 0 }, errors: [] });
});

test("guarda el estado de cada remito y cuenta por estado", async () => {
  const { db, calls } = fakeDb({ due: [event(1), event(2), event(3), event(4)] });
  const { client } = clientAnswering({
    "dispatch:SO-1": { status: "draft", erpReference: "MAT-DN-1" },
    "dispatch:SO-2": { status: "confirmed", erpReference: "MAT-DN-2" },
    "dispatch:SO-3": { status: "cancelled", erpReference: "MAT-DN-3" },
    "dispatch:SO-4": { status: "not_found", erpReference: null },
  });
  const result = await checkErpDispatchDocuments({ db, companyId: "company-1", getClient: () => client, limit: 5 });

  assert.equal(calls[0].args.p_limit, 5);
  assert.deepEqual(calls.slice(1).map((call) => call.args), [
    { p_event_id: "event-1", p_status: "draft", p_erp_reference: "MAT-DN-1" },
    { p_event_id: "event-2", p_status: "confirmed", p_erp_reference: "MAT-DN-2" },
    { p_event_id: "event-3", p_status: "cancelled", p_erp_reference: "MAT-DN-3" },
    { p_event_id: "event-4", p_status: "not_found", p_erp_reference: null },
  ]);
  assert.deepEqual(result.counters, { received: 4, draft: 1, confirmed: 1, cancelled: 1, not_found: 1, failed: 0 });
  assert.deepEqual(result.errors, []);
});

test("un error permanente de un remito se audita y sigue con los demás", async () => {
  const { db } = fakeDb({ due: [event(1), event(2)] });
  const { client, asked } = clientAnswering({
    "dispatch:SO-1": new ErpError("unauthorized", "Credenciales del ERP inválidas.", { status: 401 }),
    "dispatch:SO-2": { status: "confirmed", erpReference: null },
  });
  const result = await checkErpDispatchDocuments({ db, companyId: "company-1", getClient: () => client });
  assert.deepEqual(asked, ["dispatch:SO-1", "dispatch:SO-2"]);
  assert.deepEqual(result.counters, { received: 2, draft: 0, confirmed: 1, cancelled: 0, not_found: 0, failed: 1 });
  assert.deepEqual(result.errors, [{ external_id: "dispatch:SO-1", message: "Al consultar el remito en el ERP: Credenciales del ERP inválidas." }]);
});

test("si el ERP no responde, corta la consulta y cuenta los que faltaban como fallidos", async () => {
  const { db, calls } = fakeDb({ due: [event(1), event(2), event(3)] });
  const { client, asked } = clientAnswering({ "dispatch:SO-1": new ErpError("timeout", "El ERP no respondió a tiempo.") });
  const result = await checkErpDispatchDocuments({ db, companyId: "company-1", getClient: () => client });
  assert.deepEqual(asked, ["dispatch:SO-1"]);
  assert.equal(calls.filter((call) => call.fn === "erp_outbox_record_dispatch_document").length, 0);
  assert.equal(result.counters.failed, 3);
  assert.equal(result.errors.length, 1);
});

test("una respuesta fuera de contrato o un error inesperado no filtran detalles", async () => {
  const { db } = fakeDb({ due: [event(1), event(2)] });
  const { client } = clientAnswering({
    "dispatch:SO-1": { status: "submitted", erpReference: "X" } as never,
    "dispatch:SO-2": new TypeError("Authorization: token abc:def"),
  });
  const result = await checkErpDispatchDocuments({ db, companyId: "company-1", getClient: () => client });
  assert.deepEqual(result.errors.map((error) => error.message), [
    "Al consultar el remito en el ERP: El ERP respondió el estado del remito con un formato inesperado.",
    "Error inesperado al consultar el remito en el ERP.",
  ]);
  assert.equal(result.counters.failed, 2);
});

test("si la base no deja leer o guardar, queda como error sin lanzar", async () => {
  const denied = await checkErpDispatchDocuments({ db: fakeDb({ dueError: "42501" }).db, companyId: "c", getClient: () => new MockErpClient() });
  assert.deepEqual(denied.errors, [{ external_id: null, message: "No tenés permisos para consultar los remitos en el ERP." }]);

  const { db } = fakeDb({ due: [event(1)], recordResult: false });
  const result = await checkErpDispatchDocuments({ db, companyId: "c", getClient: () => new MockErpClient() });
  assert.equal(result.counters.failed, 1);
  assert.equal(result.counters.confirmed, 0);
  assert.match(result.errors[0].message, /No se pudo guardar/);
});

test("una configuración inválida del ERP marca todo como fallido", async () => {
  const { db } = fakeDb({ due: [event(1), event(2)] });
  const result = await checkErpDispatchDocuments({
    db,
    companyId: "c",
    getClient: () => { throw new ErpError("config", "ERP_PROVIDER inválido."); },
  });
  assert.equal(result.counters.failed, 2);
  assert.deepEqual(result.errors, [{ external_id: null, message: "Al consultar el remito en el ERP: ERP_PROVIDER inválido." }]);
});

test("con el mock real: un reporte enviado figura confirmado", async () => {
  const { db, calls } = fakeDb({ due: [event(12)] });
  const result = await checkErpDispatchDocuments({ db, companyId: "c", getClient: () => new MockErpClient() });
  assert.equal(result.counters.confirmed, 1);
  assert.deepEqual(calls[1].args, { p_event_id: "event-12", p_status: "confirmed", p_erp_reference: null });
});
