import assert from "node:assert/strict";
import { test } from "node:test";

import { readStaleAfterHours } from "./config.ts";

test("umbral de desactualizado: 24 h por defecto", () => {
  assert.equal(readStaleAfterHours({}), 24);
  assert.equal(readStaleAfterHours({ ERP_SYNC_STALE_AFTER_HOURS: " " }), 24);
});

test("acepta horas positivas, incluso con decimales", () => {
  assert.equal(readStaleAfterHours({ ERP_SYNC_STALE_AFTER_HOURS: "6" }), 6);
  assert.equal(readStaleAfterHours({ ERP_SYNC_STALE_AFTER_HOURS: "0.5" }), 0.5);
});

test("un valor inválido usa el defecto", () => {
  for (const value of ["0", "-3", "abc", "Infinity", "100000"]) {
    assert.equal(readStaleAfterHours({ ERP_SYNC_STALE_AFTER_HOURS: value }), 24, value);
  }
});
