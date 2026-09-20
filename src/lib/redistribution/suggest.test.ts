import assert from "node:assert/strict";
import { test } from "node:test";

import {
  suggestRedistributions,
  type DistributorCoverageInput,
  type StagnantPalletInput,
} from "./suggest.ts";

function pallet(overrides: Partial<StagnantPalletInput> = {}): StagnantPalletInput {
  return {
    id: "p1",
    qrCode: "QR-1",
    status: "in_warehouse",
    productName: "Yerba",
    productSku: "YER-1",
    quantity: 50,
    unitOfMeasure: "unidades",
    daysWithoutMovement: 40,
    ...overrides,
  };
}

function coverage(overrides: Partial<DistributorCoverageInput> = {}): DistributorCoverageInput {
  const currentStock = overrides.currentStock ?? 100;
  const dailyConsumption = overrides.dailyConsumption ?? 20;
  const stockDays = currentStock / dailyConsumption;
  return {
    distributorName: "Norte",
    productName: "Yerba",
    productSku: "YER-1",
    currentStock,
    dailyConsumption,
    unitOfMeasure: "unidades",
    stockDays,
    riskLevel: stockDays <= 7 ? "critical" : stockDays <= 14 ? "caution" : null,
    ...overrides,
  };
}

test("sugiere el pallet cuando hay faltante del mismo producto y la misma unidad", () => {
  const [suggestion] = suggestRedistributions([pallet()], [coverage()]);

  assert.equal(suggestion.compatible, true);
  assert.equal(suggestion.distributorName, "Norte");
  assert.equal(suggestion.suggestedQuantity, 50);
  assert.deepEqual(suggestion.pallets.map((item) => item.id), ["p1"]);
  // (100 + 50) / 20 = 7,5 días
  assert.equal(suggestion.stockDaysAfter, 7.5);
  assert.equal(suggestion.currentStockDays, 5);
  assert.equal(suggestion.riskLevel, "critical");
});

test("no sugiere nada si ninguna distribuidora tiene faltante", () => {
  const healthy = coverage({ currentStock: 1000, dailyConsumption: 10 });
  assert.deepEqual(suggestRedistributions([pallet()], [healthy]), []);
});

test("no sugiere nada si no hay pallets del mismo SKU", () => {
  const other = pallet({ productSku: "OTRO-1" });
  assert.deepEqual(suggestRedistributions([other], [coverage()]), []);
});

test("ignora pallets que no están en depósito", () => {
  const assigned = pallet({ status: "assigned" });
  const inTransit = pallet({ id: "p2", status: "in_transit" });
  assert.deepEqual(suggestRedistributions([assigned, inTransit], [coverage()]), []);
});

test("atiende primero a la distribuidora con menos cobertura y no reutiliza pallets", () => {
  const pallets = [pallet({ id: "p1", quantity: 500 })];
  const coverages = [
    coverage({ distributorName: "Sur", currentStock: 120, dailyConsumption: 10 }),
    coverage({ distributorName: "Norte", currentStock: 20, dailyConsumption: 10 }),
  ];

  const suggestions = suggestRedistributions(pallets, coverages);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].distributorName, "Norte");
});

test("reparte los pallets entre varias distribuidoras con faltante", () => {
  const pallets = [
    pallet({ id: "p1", quantity: 300, daysWithoutMovement: 60 }),
    pallet({ id: "p2", quantity: 300, daysWithoutMovement: 40 }),
  ];
  const coverages = [
    coverage({ distributorName: "Norte", currentStock: 10, dailyConsumption: 10 }),
    coverage({ distributorName: "Sur", currentStock: 50, dailyConsumption: 10 }),
  ];

  const suggestions = suggestRedistributions(pallets, coverages);

  assert.deepEqual(suggestions.map((item) => item.distributorName), ["Norte", "Sur"]);
  assert.deepEqual(suggestions[0].pallets.map((item) => item.id), ["p1"]);
  assert.deepEqual(suggestions[1].pallets.map((item) => item.id), ["p2"]);
});

test("usa primero los pallets más antiguos y corta al cubrir lo necesario", () => {
  // Necesita 30 * 10 - 20 = 280 unidades.
  const pallets = [
    pallet({ id: "nuevo", quantity: 200, daysWithoutMovement: 31 }),
    pallet({ id: "viejo", quantity: 200, daysWithoutMovement: 90 }),
    pallet({ id: "medio", quantity: 200, daysWithoutMovement: 60 }),
  ];

  const [suggestion] = suggestRedistributions(pallets, [coverage({ currentStock: 20, dailyConsumption: 10 })]);

  assert.deepEqual(suggestion.pallets.map((item) => item.id), ["viejo", "medio"]);
  assert.equal(suggestion.suggestedQuantity, 400);
});

test("marca como no compatible si la unidad del pallet difiere del stock", () => {
  const boxes = pallet({ unitOfMeasure: "cajas", quantity: 10 });

  const [suggestion] = suggestRedistributions([boxes], [coverage()]);

  assert.equal(suggestion.compatible, false);
  assert.equal(suggestion.suggestedQuantity, null);
  assert.equal(suggestion.stockDaysAfter, null);
  assert.deepEqual(suggestion.pallets.map((item) => item.id), ["p1"]);
});

test("un pallet sin cantidad definida no cuenta como compatible", () => {
  const undefinedQuantity = pallet({ quantity: null, unitOfMeasure: null });

  const [suggestion] = suggestRedistributions([undefinedQuantity], [coverage()]);

  assert.equal(suggestion.compatible, false);
  assert.equal(suggestion.suggestedQuantity, null);
});

test("prefiere los pallets compatibles y descarta los de otra unidad", () => {
  const pallets = [
    pallet({ id: "cajas", unitOfMeasure: "cajas", quantity: 10, daysWithoutMovement: 90 }),
    pallet({ id: "unidades", quantity: 50 }),
  ];

  const [suggestion] = suggestRedistributions(pallets, [coverage()]);

  assert.equal(suggestion.compatible, true);
  assert.deepEqual(suggestion.pallets.map((item) => item.id), ["unidades"]);
});
