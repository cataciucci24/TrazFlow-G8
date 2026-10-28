import assert from "node:assert/strict";
import test from "node:test";
import { formatPlanPrice, operatorLimitLabel, palletLimitLabel } from "./types.ts";

test("los precios distinguen cero, centavos y cotización a medida", () => {
  assert.match(formatPlanPrice(6900), /69/);
  assert.match(formatPlanPrice(26900), /269/);
  assert.match(formatPlanPrice(135000), /1\.350/);
  assert.match(formatPlanPrice(6950), /69,50/);
  assert.match(formatPlanPrice(0), /0/);
  assert.equal(formatPlanPrice(null), "A medida");
});

test("los límites distinguen operadores y pallets por mes, sin confundir ilimitado con cero", () => {
  assert.equal(operatorLimitLabel(3), "Hasta 3 operadores");
  assert.equal(operatorLimitLabel(10), "Hasta 10 operadores");
  assert.equal(operatorLimitLabel(null), "Operadores ilimitados");
  assert.equal(palletLimitLabel(500), "Hasta 500 pallets por mes");
  assert.equal(palletLimitLabel(3000), "Hasta 3.000 pallets por mes");
  assert.equal(palletLimitLabel(null), "Pallets sin límite mensual");
});
