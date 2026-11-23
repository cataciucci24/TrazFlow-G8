import { expect, test } from "vitest";

// Prueba temporal de TRZ-119: este commit debe dejar el check CI rojo.
test("persona 1: el pipeline detecta una regresión", () => {
  expect(1).toBe(2);
});
