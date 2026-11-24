import assert from "node:assert/strict";
import { test } from "vitest";

import { activityBadge, integrationStatusCards, isSyncStale, overallIntegrationStatus } from "./status.ts";
import type { ErpHealthState, IntegrationSummary } from "./types.ts";

const NOW = new Date("2026-10-19T12:00:00Z");
const OK: ErpHealthState = { status: "ok", provider: "mock", latencyMs: 3, checkedAt: NOW.toISOString() };
const HEALTHY: IntegrationSummary = {
  pendingCount: 0, processingCount: 0, failedCount: 0, sentCount: 4, oldestPendingAt: null, runningSyncCount: 0,
  lastRun: { id: "r", status: "success", startedAt: "2026-10-19T10:00:00Z", finishedAt: "2026-10-19T10:01:00Z" },
  lastSuccessAt: "2026-10-19T10:01:00Z", unreportedCount: 0,
};

function overall(summary: Partial<IntegrationSummary>, health: ErpHealthState | null = OK, staleAfterHours = 24) {
  return overallIntegrationStatus({ health, summary: { ...HEALTHY, ...summary }, staleAfterHours, now: NOW });
}

test("badges por fila con los estados reales", () => {
  assert.equal(activityBadge("sync", "running"), "syncing");
  assert.equal(activityBadge("sync", "success"), "healthy");
  assert.equal(activityBadge("sync", "partial"), "failed");
  assert.equal(activityBadge("sync", "failed"), "failed");
  assert.equal(activityBadge("dispatch_confirmed", "pending"), "pending");
  assert.equal(activityBadge("dispatch_confirmed", "processing"), "syncing");
  assert.equal(activityBadge("dispatch_confirmed", "sent"), "healthy");
  assert.equal(activityBadge("dispatch_confirmed", "failed"), "failed");
});

test("desactualizado según el umbral", () => {
  assert.equal(isSyncStale(null, NOW, 24), true);
  assert.equal(isSyncStale("2026-10-18T12:00:01Z", NOW, 24), false);
  assert.equal(isSyncStale("2026-10-18T11:59:59Z", NOW, 24), true);
  assert.equal(isSyncStale("2026-10-19T11:00:00Z", NOW, 0.5), true);
  assert.equal(isSyncStale("no-es-fecha", NOW, 24), true);
});

test("saludable cuando todo está al día", () => {
  assert.deepEqual(overall({}), { badge: "healthy", reasons: [] });
});

test("prioridad: fallido > sincronizando > pendiente > desactualizado", () => {
  const all = overall(
    { failedCount: 1, processingCount: 1, pendingCount: 1, unreportedCount: 3, lastSuccessAt: null },
    OK,
  );
  assert.equal(all.badge, "failed");
  assert.equal(all.reasons.length, 4);
  assert.equal(overall({ processingCount: 1, pendingCount: 1, unreportedCount: 2 }).badge, "syncing");
  assert.equal(overall({ runningSyncCount: 1 }).badge, "syncing");
  assert.equal(overall({ pendingCount: 1, unreportedCount: 1, lastSuccessAt: null }).badge, "pending");
  assert.equal(overall({ lastSuccessAt: "2026-10-17T00:00:00Z" }).badge, "stale");
});

test("fallido por conexión, por la última sincronización o por reportes", () => {
  const down: ErpHealthState = { status: "error", code: "timeout", message: "El ERP no respondió.", checkedAt: NOW.toISOString() };
  assert.equal(overall({}, down).badge, "failed");
  assert.match(overall({}, down).reasons[0], /No hay conexión con el ERP: El ERP no respondió\./);
  assert.equal(overall({ lastRun: { ...HEALTHY.lastRun!, status: "partial" } }).badge, "failed");
  assert.equal(overall({ lastRun: { ...HEALTHY.lastRun!, status: "failed" } }).badge, "failed");
  assert.equal(overall({ failedCount: 2, unreportedCount: 2 }).badge, "failed");
});

test("una orden despachada sin evento cuenta como pendiente", () => {
  const status = overall({ unreportedCount: 1 });
  assert.equal(status.badge, "pending");
  assert.match(status.reasons[0], /no tienen reporte al ERP/);
});

test("sin healthcheck todavía no suma motivos de conexión", () => {
  assert.equal(overall({}, null).badge, "healthy");
});

/* ---------- TRZ-112: tarjetas del resumen ---------- */

const RUN_ID = "3f2b6c1e-8d4a-4b7e-9c2f-1a2b3c4d5e6f";

function cards(summary: Partial<IntegrationSummary>, health: ErpHealthState = OK) {
  const [connection, sync, reports] = integrationStatusCards({
    health,
    summary: { ...HEALTHY, lastRun: HEALTHY.lastRun && { ...HEALTHY.lastRun, id: RUN_ID }, ...summary },
    staleAfterHours: 24,
    now: NOW,
    formatDate: (iso) => `F(${iso.slice(0, 10)})`,
  });
  return { connection, sync, reports };
}

test("todo al día: tarjetas neutras que llevan a configuración, al detalle de la sincronización y a los reportes", () => {
  const { connection, sync, reports } = cards({});
  assert.deepEqual([connection.value, connection.tone, connection.href], ["Activa", null, "/dashboard/integrations?tab=configuracion"]);
  assert.match(connection.details[0], /mock · 3 ms/);
  assert.deepEqual([sync.value, sync.tone], ["Exitosa", null]);
  assert.equal(sync.href, `/dashboard/integrations?tab=actividad&event=sync%3A${RUN_ID}&volver=resumen`);
  assert.deepEqual([reports.value, reports.tone], ["Al día", null]);
  assert.equal(reports.href, "/dashboard/integrations?tab=actividad&kind=dispatch_confirmed");
});

test("sin conexión: tarjeta crítica con el mensaje saneado y link para revisar la configuración", () => {
  const { connection } = cards({}, { status: "error", code: "unauthorized", message: "Credenciales rechazadas.", checkedAt: NOW.toISOString() });
  assert.deepEqual([connection.value, connection.tone, connection.cta], ["Sin conexión", "critical", "Revisar configuración"]);
  assert.equal(connection.details[0], "Credenciales rechazadas.");
});

test("sincronización fallida o desactualizada", () => {
  const failed = cards({ lastRun: { id: RUN_ID, status: "failed", startedAt: "2026-10-19T11:00:00Z", finishedAt: null } }).sync;
  assert.deepEqual([failed.value, failed.tone], ["Fallida", "critical"]);
  assert.ok(failed.details.includes("Última exitosa: F(2026-10-19)"));

  const old = cards({
    lastRun: { id: RUN_ID, status: "success", startedAt: "2026-10-01T10:00:00Z", finishedAt: "2026-10-01T10:01:00Z" },
    lastSuccessAt: "2026-10-01T10:01:00Z",
  }).sync;
  assert.deepEqual([old.value, old.tone], ["Exitosa", "caution"]);
  assert.ok(old.details.includes("Desactualizada (más de 24 h)"));

  const never = cards({ lastRun: null, lastSuccessAt: null }).sync;
  assert.deepEqual([never.value, never.tone], ["Nunca", "caution"]);
  assert.equal(never.href, "/dashboard/integrations?tab=actividad&kind=sync");
});

test("reportes: lleva a lo más urgente (fallidos, después en espera, después sin reportar)", () => {
  const failed = cards({ failedCount: 2, pendingCount: 1 }).reports;
  assert.deepEqual([failed.value, failed.tone], ["2 fallidos", "critical"]);
  assert.equal(failed.href, "/dashboard/integrations?tab=actividad&kind=dispatch_confirmed&status=failed");

  const waiting = cards({ pendingCount: 1, processingCount: 1 }).reports;
  assert.deepEqual([waiting.value, waiting.tone], ["2 en espera", "caution"]);
  assert.equal(waiting.href, "/dashboard/integrations?tab=actividad&kind=dispatch_confirmed&status=pending");

  const unreported = cards({ unreportedCount: 3 }).reports;
  assert.deepEqual([unreported.value, unreported.tone, unreported.href], ["3 sin reportar", "caution", "/dashboard/integrations?tab=actividad"]);
  assert.ok(unreported.details.includes("3 despachada(s) sin reportar"));
});
