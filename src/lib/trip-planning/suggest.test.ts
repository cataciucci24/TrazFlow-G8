import assert from "node:assert/strict";
import { test } from "vitest";

import { suggestTrip, type TripOrderInput } from "./suggest.ts";

function order(id: string, palletCount: number, estimatedDate = "2026-11-24"): TripOrderInput {
  return { id, label: `SAL-ORD-${id}`, estimatedDate, palletCount };
}

test("entra justo: todas las órdenes ocupan exactamente la capacidad", () => {
  const trip = suggestTrip(10, [order("1", 4), order("2", 6)]);

  assert.equal(trip.fits, true);
  assert.equal(trip.totalPallets, 10);
  assert.equal(trip.loadedPallets, 10);
  assert.deepEqual(trip.loaded.map((item) => item.id), ["1", "2"]);
  assert.deepEqual(trip.deferred, []);
  assert.deepEqual(trip.oversized, []);
});

test("sobra una orden: se sugiere pasar al próximo viaje la de fecha más nueva y entra una más chica", () => {
  // La atrasada (22/11) va primero; la de 5 pallets ya no entra, pero la de 1 sí (first-fit).
  const trip = suggestTrip(8, [order("hoy-grande", 5), order("atrasada", 6, "2026-11-22"), order("hoy-chica", 1)]);

  assert.equal(trip.fits, false);
  assert.deepEqual(trip.loaded.map((item) => item.id), ["atrasada", "hoy-chica"]);
  assert.equal(trip.loadedPallets, 7);
  assert.deepEqual(trip.deferred.map((item) => item.id), ["hoy-grande"]);
  assert.deepEqual(trip.oversized, []);
});

test("una orden más grande que el camión se avisa aparte y no bloquea a las demás", () => {
  const trip = suggestTrip(6, [order("1", 9), order("2", 3)]);

  assert.equal(trip.fits, false);
  assert.deepEqual(trip.oversized.map((item) => item.id), ["1"]);
  assert.deepEqual(trip.loaded.map((item) => item.id), ["2"]);
  assert.deepEqual(trip.deferred, []);
  assert.equal(trip.totalPallets, 12);
});
