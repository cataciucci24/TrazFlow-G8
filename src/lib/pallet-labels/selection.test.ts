import assert from "node:assert/strict";
import test from "node:test";

import { palletLabelContent, parsePalletSelection } from "./selection.ts";

const first = "10000000-0000-0000-0000-000000000001";
const second = "10000000-0000-0000-0000-000000000002";

test("la selección elimina inválidos y duplicados sin cambiar el orden", () => {
  assert.deepEqual(parsePalletSelection(`${first},no-es-uuid,${second},${first}`), [first, second]);
});

test("el QR impreso usa exactamente el código persistido", () => {
  const content = palletLabelContent({
    id: first, qrCode: "PALLET-CODE-001", status: "in_warehouse", currentLocation: "A-01",
    productName: "Producto", productSku: "SKU-1", batchNumber: "LOTE-9", quantity: 12,
    unitOfMeasure: "cajas",
  });
  assert.equal(content.qrValue, "PALLET-CODE-001");
  assert.equal(content.readableCode, content.qrValue);
  assert.deepEqual(content, {
    qrValue: "PALLET-CODE-001", readableCode: "PALLET-CODE-001", product: "Producto",
    batch: "LOTE-9", quantity: 12, unit: "cajas",
  });
});
