import assert from "node:assert/strict";
import { test } from "node:test";

import { activityBadge, isSyncStale, overallIntegrationStatus } from "./status.ts";
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
