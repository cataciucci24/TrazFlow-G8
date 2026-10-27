import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { canCreateManualOrders } from "./erp-policy.ts";

/** TRZ-102: con el ERP activo, las órdenes de despacho solo entran por la sincronización. */

test("sin ERP se pueden crear órdenes a mano; con ERP no", () => {
  assert.equal(canCreateManualOrders(false), true);
  assert.equal(canCreateManualOrders(true), false);
});

function createDispatchOrderSource(): string {
  const source = readFileSync(join(import.meta.dirname, "actions.ts"), "utf8");
  const start = source.indexOf("export async function createDispatchOrder(");
  assert.notEqual(start, -1, "createDispatchOrder no está en actions.ts");
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

test("createDispatchOrder exige ERP desactivado después del rol y antes de escribir", () => {
  const body = createDispatchOrderSource();
  const roleCheck = body.indexOf('hasRole(profile, "logistics_manager")');
  const erpCheck = body.indexOf("canCreateManualOrders(await isErpEnabled(profile.companyId))");
  const firstWrite = body.search(/\.(insert|update|delete|rpc)\(/);

  assert.notEqual(roleCheck, -1, "falta el chequeo de rol");
  assert.notEqual(erpCheck, -1, "falta el chequeo de ERP");
  assert.notEqual(firstWrite, -1, "no se encontró la escritura de la orden");
  assert.ok(roleCheck < erpCheck, "el chequeo de ERP va después del de rol");
  assert.ok(erpCheck < firstWrite, "el chequeo de ERP va antes de cualquier escritura");
  assert.match(body.slice(erpCheck, firstWrite), /ERP_MANAGED_ORDERS_ERROR/, "con ERP devuelve el error en errors.form");
});
