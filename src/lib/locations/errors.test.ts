import assert from "node:assert/strict";
import test from "node:test";
import { locationErrorMessage } from "./errors.ts";

test("conserva explicaciones del backend de permisos, estado y conflicto", () => {
  for (const [code, message] of [
    ["42501", "Solo un operador de deposito activo puede registrar movimientos."],
    ["P0002", "La ubicacion no existe o no pertenece a tu empresa."],
    ["23514", "El pallet ya esta en esa ubicacion."],
    ["40001", "La ubicacion cambio mientras operabas. Actualiza la pantalla e intenta nuevamente."],
    ["P0001", "La ubicación seleccionada no admite esta operación."],
  ]) assert.equal(locationErrorMessage({ code, message }, "move"), message);
});
test("traduce diagnósticos SQL a acciones concretas sin exponer nombres internos", () => {
  assert.match(locationErrorMessage({ code: "23505", message: "duplicate key violates warehouse_locations_company_id_code_key" }, "create"), /Ya existe/);
  assert.match(locationErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "warehouse_locations"' }, "create"), /No tenés permisos/);
  assert.match(locationErrorMessage({ code: "23514", message: "violates check constraint warehouse_locations_code_check" }, "create"), /Revisá el código/);
  assert.match(locationErrorMessage({ code: "23503", message: "foreign key violation" }, "move"), /Actualizá los datos/);
  assert.doesNotMatch(locationErrorMessage({ code: "XX000", message: "internal database details" }, "move"), /internal database/);
});
