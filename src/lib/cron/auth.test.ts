import assert from "node:assert/strict";
import { test } from "node:test";

import { isCronAuthorized } from "./auth.ts";

const SECRET = "s3creto-del-cron-de-prueba-1234567890";

test("acepta solo el header Bearer con el secreto exacto", () => {
  assert.equal(isCronAuthorized(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isCronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(isCronAuthorized(`bearer ${SECRET}`, SECRET), false);
  assert.equal(isCronAuthorized(SECRET, SECRET), false);
  assert.equal(isCronAuthorized("Bearer otro", SECRET), false);
});

test("sin header rechaza", () => {
  assert.equal(isCronAuthorized(null, SECRET), false);
  assert.equal(isCronAuthorized(undefined, SECRET), false);
  assert.equal(isCronAuthorized("", SECRET), false);
});

test("sin CRON_SECRET (o vacío o corto) rechaza siempre, nunca abierto por defecto", () => {
  assert.equal(isCronAuthorized("Bearer undefined", undefined), false);
  assert.equal(isCronAuthorized("Bearer ", ""), false);
  assert.equal(isCronAuthorized("Bearer    ", "   "), false);
  assert.equal(isCronAuthorized("Bearer corto", "corto"), false);
});
