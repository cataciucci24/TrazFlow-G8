import assert from "node:assert/strict";
import { test } from "vitest";

import { buildTimeline, toTimelineEntry, type TimelineEventRow } from "./timeline.ts";

function row(overrides: Partial<TimelineEventRow>): TimelineEventRow {
  return {
    id: "e1", event_type: "qr_scan", created_at: "2026-11-20T12:00:00.000Z",
    pallet_id: "p1", order_id: "o1", details: null, user_name: "Depósito", ...overrides,
  };
}

test("cada tipo de evento tiene título, detalle y tono", () => {
  assert.deepEqual(
    [toTimelineEntry(row({ event_type: "dispatch_confirmed", pallet_id: null, details: { pallet_count: 2 } }))]
      .map(({ title, description, tone }) => ({ title, description, tone })),
    [{ title: "Despacho confirmado", description: "2 pallets en la orden", tone: "success" }],
  );
  const moved = toTimelineEntry(row({
    event_type: "location_changed", user_name: null,
    details: { previous_location: "DEP-01 / A1", new_location: "DEP-01 / B2", user_name: "Ana" },
  }));
  assert.equal(moved.description, "DEP-01 / A1 → DEP-01 / B2");
  assert.equal(moved.actor, "Ana", "las ubicaciones traen el nombre en el evento");
  assert.equal(toTimelineEntry(row({ event_type: "delivery_confirmed", details: { outcome: "damaged" } })).tone, "danger");
  assert.equal(toTimelineEntry(row({ event_type: "dispatch_discrepancy", details: { type: "wrong_order" } })).description,
    "No corresponde a la orden");
  assert.equal(toTimelineEntry(row({ event_type: "nuevo_tipo" })).title, "nuevo_tipo", "un tipo desconocido no rompe la vista");
});

test("la línea de tiempo va en orden cronológico, con el alta primero y sin duplicados", () => {
  const timeline = buildTimeline(
    [
      row({ id: "b", event_type: "dispatch_confirmed", created_at: "2026-11-20T15:00:00.000Z" }),
      row({ id: "a", event_type: "pallet_associated", created_at: "2026-11-20T10:00:00.000Z" }),
      row({ id: "a", event_type: "pallet_associated", created_at: "2026-11-20T10:00:00.000Z" }),
    ],
    [{ palletId: "p1", qrCode: "PAL-1", createdAt: "2026-11-20T10:00:00.000Z" }],
  );
  assert.deepEqual(timeline.map((entry) => entry.eventType), ["pallet_created", "pallet_associated", "dispatch_confirmed"]);
  assert.equal(timeline[1].palletCode, "PAL-1");
});

test("la exportación tiene una fila por evento, con la orden completa", async () => {
  const { timelineExportRows } = await import("./timeline.ts");
  const rows = timelineExportRows(buildTimeline(
    [row({ id: "a", event_type: "pallet_associated", order_id: "o-123456789" })],
    [{ palletId: "p1", qrCode: "PAL-1", createdAt: "2026-11-20T10:00:00.000Z" }],
  ));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].slice(1), ["Pallet armado", "", "Alta en TrazFlow", "PAL-1", ""]);
  assert.deepEqual(rows[1].slice(1), ["Asociado a una orden", "", "Depósito", "PAL-1", "o-123456789"]);
});
