import assert from "node:assert/strict";
import test from "node:test";
import { businessDate, forecastCustomerOrders, type ForecastOrder, type ForecastProductLine } from "./forecast.ts";

const now = new Date("2026-11-01T15:00:00Z");
const customer = { id: "c1", name: "Cliente uno" };
function order(id: string, date: string, status = "confirmed", customerId = customer.id): ForecastOrder {
  return { id, customerId, confirmedAt: `${date}T15:00:00Z`, status };
}
const history = [order("o1", "2026-10-01"), order("o2", "2026-10-11", "delivered"), order("o3", "2026-10-21", "delivered_with_discrepancy")];
function product(orderId: string, quantity: number | null, id = "p1"): ForecastProductLine {
  return { orderId, quantity, productId: id, name: `Producto ${id}`, sku: id, unit: "cajas" };
}

test("de cero a dos despachos muestra historial insuficiente, sin inventar fechas", () => {
  for (let count = 0; count < 3; count++) {
    const [result] = forecastCustomerOrders([customer], history.slice(0, count), [], now);
    assert.equal(result.dispatchCount, count);
    assert.equal(result.estimatedDate, null);
    assert.equal(result.rangeStart, null);
    assert.equal(result.overdueDays, 0);
  }
});

test("incluye entregados y calcula media, rango, última fecha y días pasados", () => {
  const [result] = forecastCustomerOrders([customer], history, [], now);
  assert.equal(result.dispatchCount, 3);
  assert.equal(result.averageIntervalDays, 10);
  assert.equal(result.lastDispatchDate, "2026-10-21");
  assert.equal(result.estimatedDate, "2026-10-31");
  assert.equal(result.rangeStart, "2026-10-31");
  assert.equal(result.rangeEnd, "2026-10-31");
  assert.equal(result.overdueDays, 1);
});

test("intervalos variables amplían el rango, sin trasladar artificialmente fechas pasadas", () => {
  const [result] = forecastCustomerOrders([customer], [order("1", "2026-10-01"), order("2", "2026-10-07"), order("3", "2026-10-21")], [], now);
  assert.equal(result.averageIntervalDays, 10);
  assert.equal(result.estimatedDate, "2026-10-31");
  assert.equal(result.rangeStart, "2026-10-27");
  assert.equal(result.rangeEnd, "2026-11-04");
  assert.equal(result.overdueDays, 1);
});

test("descarta borradores, fechas ausentes, inválidas y futuras, y órdenes duplicadas", () => {
  const [result] = forecastCustomerOrders([customer], [...history, history[0], order("draft", "2026-10-25", "draft"),
    order("future", "2026-12-01"), { ...history[0], id: "empty", confirmedAt: null }, { ...history[0], id: "bad", confirmedAt: "invalid" }], [], now);
  assert.equal(result.dispatchCount, 3);
  assert.equal(result.estimatedDate, "2026-10-31");
});

test("usa días argentinos, admite varios despachos por día y estima como mínimo mañana", () => {
  assert.equal(businessDate(new Date("2026-10-22T01:00:00Z")), "2026-10-21");
  const sameDay = ["1", "2", "3"].map((id) => ({ ...order(id, "2026-10-21"), confirmedAt: "2026-10-22T01:00:00Z" }));
  const [result] = forecastCustomerOrders([customer], sameDay, [], new Date("2026-10-22T02:00:00Z"));
  assert.equal(result.averageIntervalDays, 0);
  assert.equal(result.estimatedDate, "2026-10-22");
  assert.equal(result.rangeStart, "2026-10-22");
  assert.equal(result.rangeEnd, "2026-10-22");
  assert.equal(result.overdueDays, 0);
});

test("ordena por fecha estimada y deja los clientes sin historial al final", () => {
  const customers = [customer, { id: "c2", name: "Sin historial" }, { id: "c3", name: "Más próximo" }];
  const more = [order("a", "2026-10-01", "confirmed", "c3"), order("b", "2026-10-06", "confirmed", "c3"), order("c", "2026-10-11", "confirmed", "c3")];
  const forecasts = forecastCustomerOrders(customers, [...history, ...more], [], now);
  assert.deepEqual(forecasts.map((item) => item.customerId), ["c3", "c1", "c2"]);
});

test("suma pallets del mismo producto por pedido antes de promediar, conserva unidades y ranking", () => {
  const lines = [product("o1", 2), product("o1", 3), product("o2", 15), product("o1", 100, "p2"), product("o3", 1.5, "p3"),
    { ...product("o1", 1, "p4"), unit: "kilogramos" }, product("other-company-order", 999)];
  const [result] = forecastCustomerOrders([customer], history, lines, now);
  assert.equal(result.products.length, 3);
  assert.equal(result.products[0].id, "p1");
  assert.equal(result.products[0].orderCount, 2);
  assert.equal(result.products[0].averageQuantity, 10); // (2 + 3 + 15) / 2 pedidos
  assert.equal(result.products[0].measuredOrderCount, 2);
  assert.equal(result.products[0].unit, "cajas");
});

test("no convierte cantidades faltantes en cero ni usa pedidos con sumas incompletas", () => {
  const [result] = forecastCustomerOrders([customer], history,
    [product("o1", 2), product("o1", null), product("o2", 4), product("o3", null, "unknown")], now);
  const p1 = result.products.find((item) => item.id === "p1")!;
  assert.equal(p1.averageQuantity, 4);
  assert.equal(p1.orderCount, 2);
  assert.equal(p1.measuredOrderCount, 1);
  assert.equal(result.products.find((item) => item.id === "unknown")!.averageQuantity, null);
});

test("cada cliente tiene únicamente sus fechas y productos", () => {
  const customers = [customer, { id: "c2", name: "Otro" }];
  const [first, second] = forecastCustomerOrders(customers, [...history, order("other", "2026-10-01", "confirmed", "c2")],
    [product("other", 100, "foreign")], now);
  assert.equal(first.customerId, "c1");
  assert.deepEqual(first.products, []);
  assert.equal(second.dispatchCount, 1);
  assert.equal(second.products[0].id, "foreign");
});
