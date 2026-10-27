import assert from "node:assert/strict";
import { test } from "node:test";

import { erpStockErrorMessage } from "./erp-stock-errors.ts";

const detail = (available: number, unit = "cajas") =>
  JSON.stringify({ available, unit, lot: "L-2026-0915", warehouseCode: "DEP-01" });

test("tope superado: mensaje con el disponible", () => {
  assert.equal(erpStockErrorMessage({ code: "TF100", details: detail(55) }),
    "La cantidad supera el saldo del ERP: quedan 55 cajas disponibles del lote L-2026-0915 en DEP-01.");
  assert.equal(erpStockErrorMessage({ code: "TF100", details: detail(12.5, "kilogramos") }),
    "La cantidad supera el saldo del ERP: quedan 12,5 kilogramos disponibles del lote L-2026-0915 en DEP-01.");
  assert.equal(erpStockErrorMessage({ code: "TF100", details: detail(1) }),
    "La cantidad supera el saldo del ERP: quedan 1 caja disponibles del lote L-2026-0915 en DEP-01.");
});

test("sin disponible (o negativo) no se ofrece una cantidad", () => {
  assert.equal(erpStockErrorMessage({ code: "TF100", details: detail(0) }), "No queda saldo disponible del lote L-2026-0915 en DEP-01 para armar pallets.");
  assert.equal(erpStockErrorMessage({ code: "TF100", details: detail(-10) }), "No queda saldo disponible del lote L-2026-0915 en DEP-01 para armar pallets.");
});

test("detalle ausente o malformado: mensaje genérico del tope", () => {
  assert.equal(erpStockErrorMessage({ code: "TF100", details: null }), "La cantidad supera el saldo disponible del lote en el ERP.");
  assert.equal(erpStockErrorMessage({ code: "TF100", details: "{no json" }), "La cantidad supera el saldo disponible del lote en el ERP.");
  assert.equal(erpStockErrorMessage({ code: "TF100", details: JSON.stringify({ available: 3, unit: "litros" }) }), "La cantidad supera el saldo disponible del lote en el ERP.");
});

test("sin saldo, inactivo y errores ajenos", () => {
  assert.match(erpStockErrorMessage({ code: "TF101" }) ?? "", /no tiene saldo en el ERP/);
  assert.match(erpStockErrorMessage({ code: "TF102" }) ?? "", /inactivo en el ERP/);
  assert.equal(erpStockErrorMessage({ code: "23505" }), null);
  assert.equal(erpStockErrorMessage(null), null);
});
