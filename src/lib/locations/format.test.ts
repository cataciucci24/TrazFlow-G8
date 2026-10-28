import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePalletLocations,
  formatPalletLocation,
  NO_LOCATION_LABEL,
  sortByLocation,
  toPalletLocation,
  type PalletLocation,
} from "./format.ts";

function loc(warehouseCode: string, code: string, aisle = "1", rack = "1", level = "1", position = "1"): PalletLocation {
  return { warehouseCode, code, aisle, rack, level, position };
}

test("formatea depósito y código, o 'Sin ubicación'", () => {
  assert.equal(formatPalletLocation(loc("DEP-01", "DEP01-P01-E01-N01-P02")), "DEP-01 / DEP01-P01-E01-N01-P02");
  assert.equal(formatPalletLocation(null), NO_LOCATION_LABEL);
  assert.equal(formatPalletLocation(undefined), "Sin ubicación");
});

test("mapea la fila de Postgrest como objeto, array o null", () => {
  const raw = { warehouse_code: "DEP-01", code: "A01", aisle: "A", rack: "2", level: "1", position: "3" };
  const expected = { warehouseCode: "DEP-01", code: "A01", aisle: "A", rack: "2", level: "1", position: "3" };
  assert.deepEqual(toPalletLocation(raw), expected);
  assert.deepEqual(toPalletLocation([raw]), expected);
  assert.equal(toPalletLocation([]), null);
  assert.equal(toPalletLocation(null), null);
  assert.equal(toPalletLocation(undefined), null);
});

test("ordena por depósito, pasillo, estantería, nivel y posición", () => {
  const items = [
    { id: "b-dep", location: loc("DEP-02", "X", "1") },
    { id: "pos2", location: loc("DEP-01", "P2", "1", "1", "1", "2") },
    { id: "level2", location: loc("DEP-01", "L2", "1", "1", "2", "1") },
    { id: "rack2", location: loc("DEP-01", "R2", "1", "2", "1", "1") },
    { id: "aisle2", location: loc("DEP-01", "A2", "2", "1", "1", "1") },
    { id: "first", location: loc("DEP-01", "F", "1", "1", "1", "1") },
  ];
  assert.deepEqual(sortByLocation(items).map((item) => item.id), ["first", "pos2", "level2", "rack2", "aisle2", "b-dep"]);
});

test("el orden es natural: 2 antes que 10, sin distinguir mayúsculas", () => {
  const items = [
    { id: "10", location: loc("DEP-01", "X10", "10") },
    { id: "2", location: loc("DEP-01", "X2", "2") },
    { id: "b", location: loc("DEP-01", "XB", "b") },
    { id: "A", location: loc("DEP-01", "XA", "A") },
  ];
  assert.deepEqual(sortByLocation(items).map((item) => item.id), ["2", "10", "A", "b"]);
});

test("los pallets sin ubicación van al final y conservan su orden", () => {
  const items = [
    { id: "none-1", location: null },
    { id: "b03", location: loc("DEP-01", "B03", "B") },
    { id: "none-2" },
    { id: "a01", location: loc("DEP-01", "A01", "A") },
  ];
  assert.deepEqual(sortByLocation(items).map((item) => item.id), ["a01", "b03", "none-1", "none-2"]);
  assert.equal(comparePalletLocations(null, undefined), 0);
});

test("con varios depósitos agrupa primero por depósito", () => {
  const items = [
    { id: "norte-a", location: loc("DEPOSITO-NORTE", "N1", "A") },
    { id: "dep01-z", location: loc("DEP-01", "Z9", "Z") },
  ];
  assert.deepEqual(sortByLocation(items).map((item) => item.id), ["dep01-z", "norte-a"]);
});

test("no modifica el array original", () => {
  const items = [{ location: null }, { location: loc("DEP-01", "A") }];
  sortByLocation(items);
  assert.equal(items[0].location, null);
});
