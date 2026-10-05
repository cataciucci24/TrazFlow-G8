import assert from "node:assert/strict";
import test from "node:test";
import { actionErrorMessage, registrationErrorMessage } from "./feedback-messages.ts";

test("oculta diagnósticos de base de datos en los errores de órdenes y stock conocidos", () => {
  for (const prefix of ["No se pudo crear la orden", "No se pudo guardar el stock", "No se pudo leer la orden", "No se pudieron reservar los pallets", "No se pudo asociar los pallets a la orden"]) {
    assert.equal(actionErrorMessage(`${prefix} (relation dispatch_orders does not exist).`), `${prefix}. Intentá nuevamente.`);
  }
});

test("no invita a repetir una asociación que ya se completó parcialmente", () => {
  const displayed = actionErrorMessage("Los pallets se asociaron, pero no se pudo registrar el evento de trazabilidad (permission denied)." );
  assert.match(displayed, /Los pallets se asociaron/);
  assert.match(displayed, /Revisá el estado de la orden antes/);
  assert.doesNotMatch(displayed, /permission denied/);
});

test("preserva las explicaciones de negocio y permisos, incluso entre paréntesis", () => {
  for (const message of ["La orden ya no admite asociar pallets (no está en estado Pendiente).", "No tenés permisos para asociar pallets a esta orden.", "Los pallets seleccionados ya no están disponibles."]) {
    assert.equal(actionErrorMessage(message), message);
  }
});

test("presenta errores de registro comprensibles sin mostrar diagnósticos internos", () => {
  assert.equal(registrationErrorMessage("Datos inválidos"), "Datos inválidos");
  assert.equal(registrationErrorMessage("No se pudo enviar la solicitud"), "No se pudo enviar la solicitud");
  assert.match(registrationErrorMessage("User already registered"), /Ya existe una cuenta/);
  assert.match(registrationErrorMessage("Email rate limit exceeded"), /Esperá unos minutos/);
  assert.equal(registrationErrorMessage("Database error saving new user"), "No se pudo crear la cuenta. Revisá los datos e intentá nuevamente.");
});
