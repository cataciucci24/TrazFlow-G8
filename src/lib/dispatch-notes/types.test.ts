import assert from "node:assert/strict";
import test from "node:test";

import { dispatchNoteTotals, formatDispatchNoteNumber, toDispatchNote } from "./types.ts";

test("el remito se arma desde la copia guardada y tolera datos faltantes", () => {
  const note = toDispatchNote({
    id: "n1", order_id: "o1", number: 12, issued_at: "2026-11-20T15:00:00.000Z",
    content: {
      issuer: { name: "TrazFlow Demo", taxId: null },
      recipient: { name: "Distribuidora Demo" },
      issuedBy: { name: "Depósito" },
      lines: [
        { palletCode: "PAL-1", productName: "Yerba", productSku: "YERBA-1KG", lotNumber: "YB-1", quantity: 20, unit: "cajas" },
        { palletCode: "PAL-2", productName: "Yerba", quantity: 20, unit: "cajas" },
        { palletCode: "PAL-3", productName: "Queso", quantity: 12.5, unit: "kilogramos" },
      ],
    },
  });
  assert.equal(formatDispatchNoteNumber(note.number), "R-000012");
  assert.equal(note.recipient.address, null);
  assert.equal(note.lines[1].lotNumber, "—");
  assert.equal(note.issuedBy, "Depósito");
  assert.equal(note.backfilled, false);
  assert.equal(dispatchNoteTotals(note.lines), "40 cajas · 12,5 kilogramos");
});

test("un contenido vacío no rompe", () => {
  const note = toDispatchNote({ id: "n1", order_id: "o1", number: 1, issued_at: "2026-11-20T15:00:00.000Z", content: null });
  assert.deepEqual(note.lines, []);
  assert.equal(note.issuer.name, "—");
});
