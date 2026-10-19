import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocationCode, validLocationCode, findScannedLocation, locationQr, canLocatePallet } from "./rules.ts";
test("códigos de ubicación estables, normalizados y acotados", () => {
  assert.equal(normalizeLocationCode(" a-01_2 "), "A-01_2");
  for (const code of ["A", "P01-E02-N03", "A_01"]) assert.ok(validLocationCode(code));
  for (const code of ["", "a", "A B", "<script>", "A".repeat(41), "-A"]) assert.equal(validLocationCode(code), false);
});
test("el QR y el código manual identifican la ubicación sin aceptar otra empresa", () => {
  const locations = [{ id: "own-id", code: "A01" }];
  assert.equal(findScannedLocation(locations, locationQr("own-id")), locations[0]);
  assert.equal(findScannedLocation(locations, " a01 "), locations[0]);
  assert.equal(findScannedLocation(locations, locationQr("foreign-id")), undefined);
  assert.equal(findScannedLocation(locations, "PAL-001"), undefined);
});
test("solo estados físicamente en depósito permiten ubicación", () => {
  assert.ok(canLocatePallet("in_warehouse"));
  assert.ok(canLocatePallet("assigned"));
  for (const status of ["in_transit", "delivered", "delivery_discrepancy", "received", "unknown"]) assert.equal(canLocatePallet(status), false);
});
