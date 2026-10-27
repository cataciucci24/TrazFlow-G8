import assert from "node:assert/strict";
import { test } from "node:test";

import { compareOrderLines, differenceWarning } from "./lines.ts";

const ACE = { productId: "p-ace", productName: "Aceite", productSku: "ACE-500", unitOfMeasure: "cajas" as const };
const ARR = { productId: "p-arr", productName: "Arroz", productSku: "ARR-1KG", unitOfMeasure: "cajas" as const };
const QSO = { productId: "p-qso", productName: "Queso", productSku: "QSO", unitOfMeasure: "kilogramos" as const };

test("suma pedido por producto (varias líneas) y armado por pallets", () => {
  const rows = compareOrderLines(
    [{ ...ACE, quantity: 40 }, { ...ACE, quantity: 25 }, { ...ARR, quantity: 40 }],
    [{ ...ACE, quantity: 40 }, { ...ACE, quantity: 25 }],
  );
  assert.deepEqual(rows.map(({ productSku, requested, built, difference }) => ({ productSku, requested, built, difference })), [
    { productSku: "ACE-500", requested: 65, built: 65, difference: 0 },
    { productSku: "ARR-1KG", requested: 40, built: 0, difference: -40 },
  ]);
});

test("lo armado que la orden no pide aparece al final, como sobrante", () => {
  const rows = compareOrderLines([{ ...ACE, quantity: 10 }], [{ ...QSO, quantity: 12.25 }, { ...ACE, quantity: 15 }]);
  assert.deepEqual(rows.map((row) => [row.productSku, row.difference]), [["ACE-500", 5], ["QSO", 12.25]]);
});

test("decimales en kilogramos sin restos de coma flotante", () => {
  const [row] = compareOrderLines([{ ...QSO, quantity: 48.25 }], [{ ...QSO, quantity: 20.1 }, { ...QSO, quantity: 28.2 }]);
  assert.equal(row.built, 48.3);
  assert.equal(row.difference, 0.05);
});

test("aviso de diferencia", () => {
  assert.equal(differenceWarning({ difference: 0, unitOfMeasure: "cajas" }), null);
  assert.equal(differenceWarning({ difference: -40, unitOfMeasure: "cajas" }), "faltan 40 cajas");
  assert.equal(differenceWarning({ difference: 5.5, unitOfMeasure: "kilogramos" }), "sobran 5,5 kilogramos");
});
