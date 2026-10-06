import assert from "node:assert/strict";
import { test } from "node:test";

import { filterActiveDispatchDiscrepancies } from "./discrepancies.ts";
import type { OrderDispatchDiscrepancy } from "./types.ts";

const SCANNED_AT = "2026-09-22T12:54:37.367+00:00";
const BEFORE = "2026-09-22T12:54:28.343+00:00";
const AFTER = "2026-10-06T15:11:25.682+00:00";

function discrepancy(palletId: string | null, createdAt = SCANNED_AT): OrderDispatchDiscrepancy {
  return { palletId, qrCode: palletId ?? "—", type: "wrong_order", createdAt };
}

test("sin cambios sobre el pallet, la discrepancia sigue activa", () => {
  const items = [discrepancy("pal-3")];
  assert.deepEqual(filterActiveDispatchDiscrepancies(items, ["pal-1"], []), items);
});

test("una orden sin pallets no muestra discrepancias", () => {
  assert.deepEqual(filterActiveDispatchDiscrepancies([discrepancy("pal-3")], [], []), []);
});

test("si el pallet escaneado ya pertenece a la orden, la discrepancia se supera", () => {
  assert.deepEqual(filterActiveDispatchDiscrepancies([discrepancy("pal-3")], ["pal-1", "pal-3"], []), []);
});

test("asociar o desasociar ese mismo pallet después del escaneo supera la discrepancia", () => {
  const items = [discrepancy("pal-3")];
  assert.deepEqual(
    filterActiveDispatchDiscrepancies(items, ["pal-1"], [{ palletId: "pal-3", createdAt: AFTER }]),
    [],
  );
});

test("un cambio sobre otro pallet no supera la discrepancia", () => {
  const items = [discrepancy("pal-3")];
  assert.deepEqual(
    filterActiveDispatchDiscrepancies(items, ["pal-6"], [{ palletId: "pal-6", createdAt: AFTER }]),
    items,
  );
});

test("un cambio sobre el pallet anterior al escaneo no supera la discrepancia", () => {
  const items = [discrepancy("pal-3")];
  assert.deepEqual(
    filterActiveDispatchDiscrepancies(items, ["pal-1"], [{ palletId: "pal-3", createdAt: BEFORE }]),
    items,
  );
});

test("una discrepancia sin pallet identificado sigue activa mientras la orden tenga pallets", () => {
  const items = [discrepancy(null)];
  assert.deepEqual(
    filterActiveDispatchDiscrepancies(items, ["pal-1"], [{ palletId: "pal-1", createdAt: AFTER }]),
    items,
  );
});
