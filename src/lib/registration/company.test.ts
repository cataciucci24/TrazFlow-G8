import assert from "node:assert/strict";
import { test } from "vitest";
import {
  COMPANY_NAME_MAX_LENGTH, companyErrorFromRpc, companyErrorMessages, isCompanyError, isRegistrationMode, normalizeCompanyName,
} from "./company.ts";

test("nombre de empresa: recorta espacios y respeta los límites de la RPC", () => {
  assert.equal(normalizeCompanyName("  Nueva Empresa SA  "), "Nueva Empresa SA");
  assert.equal(normalizeCompanyName("X"), null);
  assert.equal(normalizeCompanyName("   "), null);
  assert.equal(normalizeCompanyName("a".repeat(COMPANY_NAME_MAX_LENGTH)), "a".repeat(COMPANY_NAME_MAX_LENGTH));
  assert.equal(normalizeCompanyName("a".repeat(COMPANY_NAME_MAX_LENGTH + 1)), null);
  assert.equal(normalizeCompanyName(null), null);
});

test("modo de registro: solo join o new", () => {
  assert.equal(isRegistrationMode("join"), true);
  assert.equal(isRegistrationMode("new"), true);
  assert.equal(isRegistrationMode("admin"), false);
  assert.equal(isRegistrationMode(undefined), false);
});

test("códigos de create_company_with_manager se traducen a mensajes conocidos", () => {
  assert.equal(companyErrorFromRpc("P4107"), "invalid-cuit");
  assert.equal(companyErrorFromRpc("P4108"), "duplicate-cuit");
  assert.equal(companyErrorFromRpc("P4109"), "invalid-plan");
  assert.equal(companyErrorFromRpc("P4105"), "pending-request");
  assert.equal(companyErrorFromRpc("42501"), "company-failed");
  assert.equal(companyErrorFromRpc(undefined), "company-failed");
  // El mensaje de CUIT duplicado no revela qué empresa lo tiene.
  assert.doesNotMatch(companyErrorMessages["duplicate-cuit"], /Demo/);
});

test("solo los errores conocidos se muestran desde la URL", () => {
  assert.equal(isCompanyError("invalid-cuit"), true);
  assert.equal(isCompanyError("<script>"), false);
  assert.equal(isCompanyError("toString"), false);
});
