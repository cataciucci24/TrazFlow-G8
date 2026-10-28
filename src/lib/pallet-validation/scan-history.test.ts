import assert from "node:assert/strict";
import { test } from "node:test";

import { formatScanDate, latestScans } from "./scan-history.ts";

const AT = "2026-10-27T07:38:34Z";

test("una sola fila por código: la más reciente (sesión antes que lo guardado)", () => {
  const rows = latestScans(
    [{ code: "PAL-A", message: "No se pudo validar el pallet.", success: false }, { code: "PAL-A", message: "Pallet validado.", success: true }],
    [{ id: "e1", qrCode: "PAL-A", createdAt: AT }, { id: "e2", qrCode: "PAL-B", createdAt: AT }],
    new Set(),
  );
  assert.deepEqual(rows.map((row) => [row.code, row.tone]), [["PAL-A", "danger"], ["PAL-B", "success"]]);
  assert.equal(rows[0].message, "No se pudo validar el pallet.");
  assert.match(rows[1].message, /^Confirmado el /);
});

test("escaneo guardado de un pallet hoy pendiente: hay que volver a escanearlo", () => {
  const [row] = latestScans([], [{ id: "e1", qrCode: "PAL-A", createdAt: AT }], new Set(["PAL-A"]));
  assert.equal(row.tone, "warning");
  assert.match(row.message, /^Validado el .*, pero después se cambió la cantidad: volvé a escanearlo\.$/);
});

test("al volver a escanearlo en la sesión, manda el escaneo nuevo", () => {
  const rows = latestScans([{ code: "PAL-A", message: "Pallet validado.", success: true }], [{ id: "e1", qrCode: "PAL-A", createdAt: AT }], new Set(["PAL-A"]));
  assert.deepEqual(rows.map((row) => [row.code, row.tone, row.message]), [["PAL-A", "success", "Pallet validado."]]);
});

test("sin escaneos, sin filas", () => {
  assert.deepEqual(latestScans([], [], new Set()), []);
});

test("la fecha sale siempre en hora argentina (igual en servidor y navegador)", () => {
  assert.equal(formatScanDate("2026-10-27T07:38:34Z"), "27/10/2026, 04:38:34");
  const [row] = latestScans([], [{ id: "e1", qrCode: "PAL-A", createdAt: "2026-10-27T07:38:34Z" }], new Set());
  assert.equal(row.message, "Confirmado el 27/10/2026, 04:38:34");
});
