import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidQuantity, quantityStep } from "./units.ts";

test("en unidades y cajas la cantidad debe ser entera", () => {
  assert.equal(isValidQuantity(12, "unidades"), true);
  assert.equal(isValidQuantity(12.5, "unidades"), false);
  assert.equal(isValidQuantity(3, "cajas"), true);
  assert.equal(isValidQuantity(0.5, "cajas"), false);
});

test("en kilogramos admite hasta dos decimales", () => {
  assert.equal(isValidQuantity(12.75, "kilogramos"), true);
  assert.equal(isValidQuantity(12.755, "kilogramos"), false);
});

test("la cantidad debe ser mayor a cero y finita", () => {
  assert.equal(isValidQuantity(0, "kilogramos"), false);
  assert.equal(isValidQuantity(-3, "unidades"), false);
  assert.equal(isValidQuantity(Number.NaN, "unidades"), false);
  assert.equal(isValidQuantity(Number.POSITIVE_INFINITY, "kilogramos"), false);
});

test("el paso del input depende de la unidad", () => {
  assert.equal(quantityStep("cajas"), "1");
  assert.equal(quantityStep("kilogramos"), "0.01");
  assert.equal(quantityStep(null), "0.01");
});
