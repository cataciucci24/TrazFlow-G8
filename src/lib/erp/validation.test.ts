import assert from "node:assert/strict";
import { test } from "vitest";

import type { DeliveryReport, DispatchReport, PalletScanReport } from "./types.ts";
import { deliveryReportProblems, dispatchReportProblems, palletScanItems, palletScanReportProblems } from "./validation.ts";

/** TRZ-111: reglas del contrato v2 (pallets mixtos) sin cambiar las de v1. */

const line = (palletCode: string, lotExternalId: string) => ({
  orderLineExternalId: "SOI-1", palletCode, productExternalId: "ITEM-AGUA", lotExternalId, quantity: 40, uom: "Unit",
});

function dispatch(contractVersion: 1 | 2, lines: DispatchReport["lines"]): DispatchReport {
  return {
    contractVersion, idempotencyKey: "dispatch:SO-0042", orderExternalId: "SO-0042", dispatchedAt: "2026-11-24T13:05:00.000Z",
    operator: { id: "u-17", name: "Depósito Demo" }, lines,
  };
}

test("v1 sigue rechazando el palletCode repetido; v2 lo acepta con otro producto o lote", () => {
  const mixed = [line("P-0007", "L-AG-11"), line("P-0007", "L-AG-12")];
  assert.match(dispatchReportProblems(dispatch(1, mixed)).join(), /palletCode P-0007 está repetido/);
  assert.deepEqual(dispatchReportProblems(dispatch(2, mixed)), []);
});

test("v2: pallet + producto + lote repetidos es error (hay que sumarlos en una línea)", () => {
  const problems = dispatchReportProblems(dispatch(2, [line("P-0007", "L-AG-11"), line("P-0007", "L-AG-11")]));
  assert.match(problems.join(), /repetidos \(hay que sumarlos en una línea\)/);
});

test("scan v2: al menos un ítem y sin producto + lote repetido; un v1 se normaliza a un ítem", () => {
  const base = {
    contractVersion: 2, idempotencyKey: "pallet-scan:SO-0042:P-0007:1", scanIdempotencyKey: "pallet-scan:SO-0042:P-0007:1",
    action: "scan", orderExternalId: "SO-0042", palletCode: "P-0007", at: "2026-11-24T12:40:00.000Z",
  } as const;
  const item = { productExternalId: "ITEM-AGUA", lotExternalId: "L-AG-11", quantity: 40, uom: "Unit" };
  assert.deepEqual(palletScanReportProblems({ ...base, items: [item] }), []);
  assert.match(palletScanReportProblems({ ...base, items: [] }).join(), /al menos un ítem/);
  assert.match(palletScanReportProblems({ ...base, items: [item, { ...item, quantity: 5 }] }).join(), /repetidos/);

  const v1: PalletScanReport = { ...base, contractVersion: 1, productExternalId: "ITEM-AGUA", lotExternalId: "L-AG-12", quantity: 60, uom: "Unit" };
  assert.deepEqual(palletScanReportProblems(v1), []);
  assert.deepEqual(palletScanItems(v1), [{ productExternalId: "ITEM-AGUA", lotExternalId: "L-AG-12", quantity: 60, uom: "Unit" }]);
});

test("content_mismatch: contentDifferences obligatorio y solo ahí, nunca expected y detected los dos null, y solo en v2", () => {
  const delivery = (contractVersion: 1 | 2, discrepancies: DeliveryReport["discrepancies"]): DeliveryReport => ({
    contractVersion, idempotencyKey: "delivery:SO-0042", orderExternalId: "SO-0042", dispatchIdempotencyKey: "dispatch:SO-0042",
    deliveredAt: "2026-11-24T16:20:00.000Z", driver: { id: "u-31", name: "Chofer Demo" }, needsReview: true,
    lines: [{ palletCode: "P-0007", outcome: "delivered" }], discrepancies,
  });
  const unknown = { productExternalId: null, lotExternalId: null, observedSku: "GASEOSA-X", observedLot: "SIN-LOTE", quantity: 3, uom: "Unit" };
  const valid = delivery(2, [{ palletCode: "P-0007", type: "content_mismatch", contentDifferences: [{ expected: null, detected: unknown }] }]);
  assert.deepEqual(deliveryReportProblems(valid), []);

  assert.match(deliveryReportProblems(delivery(2, [{ palletCode: "P-0007", type: "content_mismatch" }])).join(), /contentDifferences es obligatorio/);
  assert.match(deliveryReportProblems(delivery(2, [{ palletCode: "P-0007", type: "missing", contentDifferences: [] }])).join(), /solo va con content_mismatch/);
  assert.match(deliveryReportProblems(delivery(2, [{ palletCode: "P-0007", type: "content_mismatch", contentDifferences: [{ expected: null, detected: null }] }])).join(), /los dos null/);
  assert.match(deliveryReportProblems(delivery(2, [{ palletCode: "P-0007", type: "content_mismatch", contentDifferences: [{ expected: null, detected: { ...unknown, observedSku: null } }] }])).join(), /hace falta observedSku/);
  assert.match(deliveryReportProblems({ ...valid, contractVersion: 1 }).join(), /requiere contractVersion 2/);
});

test("payloads mal formados: los validadores devuelven problemas y nunca lanzan", () => {
  const scan = {
    contractVersion: 2, idempotencyKey: "pallet-scan:SO-0042:P-0007:1", scanIdempotencyKey: "pallet-scan:SO-0042:P-0007:1",
    action: "scan", orderExternalId: "SO-0042", palletCode: "P-0007", at: "2026-11-24T12:40:00.000Z", items: [null, null],
  } as unknown as PalletScanReport;
  const delivery = (discrepancies: unknown, lines: unknown = [{ palletCode: "P-0007", outcome: "delivered" }]) => ({
    contractVersion: 2, idempotencyKey: "delivery:SO-0042", orderExternalId: "SO-0042", dispatchIdempotencyKey: "dispatch:SO-0042",
    deliveredAt: "2026-11-24T16:20:00.000Z", driver: { id: "u-31", name: null }, needsReview: true, lines, discrepancies,
  }) as unknown as DeliveryReport;

  let problems: string[] = [];
  assert.doesNotThrow(() => { problems = palletScanReportProblems(scan); });
  assert.deepEqual(problems, ["items[0] no es un objeto", "items[1] no es un objeto"]);

  assert.doesNotThrow(() => { problems = dispatchReportProblems(dispatch(2, [null] as unknown as DispatchReport["lines"])); });
  assert.deepEqual(problems, ["lines[0] no es un objeto"]);

  assert.doesNotThrow(() => { problems = deliveryReportProblems(delivery([], [null])); });
  assert.deepEqual(problems, ["lines[0] no es un objeto"]);

  assert.doesNotThrow(() => { problems = deliveryReportProblems(delivery([null])); });
  assert.deepEqual(problems, ["discrepancies[0] no es un objeto"]);

  assert.doesNotThrow(() => { problems = deliveryReportProblems(delivery([{ palletCode: "P-0007", type: "content_mismatch", contentDifferences: [null, "x"] }])); });
  assert.deepEqual(problems, [
    "discrepancies[0].contentDifferences[0] no es un objeto",
    "discrepancies[0].contentDifferences[1] no es un objeto",
  ]);
});
