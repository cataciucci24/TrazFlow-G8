import assert from "node:assert/strict";
import test from "node:test";

import { isUserRole, USER_ROLES } from "../types.ts";
import { canAccessDashboard, hasUnknownRole, toUserProfile, type UserRow } from "./profile.ts";

const row: UserRow = {
  id: "10000000-0000-0000-0000-000000000001",
  company_id: "20000000-0000-0000-0000-000000000001",
  name: "Operador",
  email: "operador@test.local",
  role: "driver_operator",
  revoked_at: null,
};

test("isUserRole acepta solo los roles vigentes", () => {
  for (const role of USER_ROLES) assert.equal(isUserRole(role), true);
  for (const value of ["distributor_operator", "", "LOGISTICS_MANAGER", null, undefined, 1]) {
    assert.equal(isUserRole(value), false);
  }
});

test("un rol vigente se mapea al perfil y puede entrar al dashboard", () => {
  const profile = toUserProfile(row);
  assert.deepEqual(profile, {
    id: row.id, companyId: row.company_id, name: row.name, email: row.email,
    role: "driver_operator", revokedAt: null,
  });
  assert.equal(hasUnknownRole(profile), false);
  assert.equal(canAccessDashboard(profile), true);
});

test("un rol desconocido no llega a la UI y no entra al dashboard", () => {
  const profile = toUserProfile({ ...row, role: "distributor_operator" });
  assert.equal(profile.role, null);
  assert.equal(hasUnknownRole(profile), true);
  if (hasUnknownRole(profile)) assert.equal(profile.unknownRole, "distributor_operator");
  assert.equal(canAccessDashboard(profile), false);
});

test("un perfil revocado no entra al dashboard aunque su rol sea vigente", () => {
  const profile = toUserProfile({ ...row, revoked_at: "2026-10-01T00:00:00Z" });
  assert.equal(hasUnknownRole(profile), false);
  assert.equal(canAccessDashboard(profile), false);
});
