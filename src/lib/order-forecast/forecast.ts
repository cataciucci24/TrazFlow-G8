export type ForecastCustomer = { id: string; name: string };
export type ForecastOrder = {
  id: string;
  customerId: string;
  confirmedAt: string | null;
  status: string;
};
export type ForecastProductLine = {
  orderId: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number | null;
};
export type FrequentProduct = {
  id: string; name: string; sku: string; unit: string;
  orderCount: number; averageQuantity: number | null; measuredOrderCount: number;
};
export type CustomerForecast = {
  customerId: string; customerName: string; dispatchCount: number;
  lastDispatchDate: string | null; averageIntervalDays: number | null;
  estimatedDate: string | null; rangeStart: string | null; rangeEnd: string | null;
  overdueDays: number; products: FrequentProduct[];
};

const DAY = 86_400_000;
const confirmedStatuses = new Set(["confirmed", "delivered", "delivered_with_discrepancy"]);
const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Día operativo argentino; el cálculo aritmético usa UTC para evitar saltos horarios. */
export function businessDate(date: Date): string {
  const parts = dateParts.formatToParts(date);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function dayNumber(date: string): number { return Date.parse(`${date}T00:00:00Z`) / DAY; }
function dayString(day: number): string { return new Date(day * DAY).toISOString().slice(0, 10); }

function frequentProducts(orders: ForecastOrder[], lines: ForecastProductLine[]): FrequentProduct[] {
  const orderIds = new Set(orders.map((order) => order.id));
  const perOrder = new Map<string, { line: ForecastProductLine; quantity: number; complete: boolean }>();
  for (const line of lines) {
    if (!orderIds.has(line.orderId)) continue;
    const key = JSON.stringify([line.orderId, line.productId]);
    const entry = perOrder.get(key) ?? { line, quantity: 0, complete: true };
    if (line.quantity === null || !Number.isFinite(line.quantity) || line.quantity < 0) entry.complete = false;
    else entry.quantity += line.quantity;
    perOrder.set(key, entry);
  }
  const products = new Map<string, FrequentProduct & { totalQuantity: number }>();
  for (const { line, quantity, complete } of perOrder.values()) {
    const product = products.get(line.productId) ?? {
      id: line.productId, name: line.name, sku: line.sku, unit: line.unit,
      orderCount: 0, averageQuantity: null, measuredOrderCount: 0, totalQuantity: 0,
    };
    product.orderCount++;
    if (complete) { product.measuredOrderCount++; product.totalQuantity += quantity; }
    products.set(line.productId, product);
  }
  return [...products.values()]
    .sort((a, b) => b.orderCount - a.orderCount || a.sku.localeCompare(b.sku) || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(({ totalQuantity, ...product }) => ({
      ...product, averageQuantity: product.measuredOrderCount ? totalQuantity / product.measuredOrderCount : null,
    }));
}

/** Estimación informativa: cada orden cuenta una vez, aunque tenga varios pallets. */
export function forecastCustomerOrders(
  customers: ForecastCustomer[], orders: ForecastOrder[], lines: ForecastProductLine[], now = new Date(),
): CustomerForecast[] {
  const today = dayNumber(businessDate(now));
  const ordersByCustomer = new Map<string, ForecastOrder[]>();
  const seen = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.id) || !confirmedStatuses.has(order.status) || !order.confirmedAt) continue;
    const time = Date.parse(order.confirmedAt);
    if (!Number.isFinite(time) || time > now.getTime()) continue;
    seen.add(order.id);
    const history = ordersByCustomer.get(order.customerId) ?? [];
    history.push(order);
    ordersByCustomer.set(order.customerId, history);
  }
  const linesByOrder = new Map<string, ForecastProductLine[]>();
  for (const line of lines) {
    const group = linesByOrder.get(line.orderId) ?? [];
    group.push(line); linesByOrder.set(line.orderId, group);
  }
  return customers.map((customer): CustomerForecast => {
    const history = ordersByCustomer.get(customer.id) ?? [];
    const days = history.map((order) => dayNumber(businessDate(new Date(order.confirmedAt!)))).sort((a, b) => a - b);
    const lastDay = days.at(-1);
    const result: CustomerForecast = {
      customerId: customer.id, customerName: customer.name, dispatchCount: days.length,
      lastDispatchDate: lastDay === undefined ? null : dayString(lastDay), averageIntervalDays: null,
      estimatedDate: null, rangeStart: null, rangeEnd: null, overdueDays: 0,
      products: frequentProducts(history, history.flatMap((order) => linesByOrder.get(order.id) ?? [])),
    };
    if (days.length < 3 || lastDay === undefined) return result;
    const gaps = days.slice(1).map((day, index) => day - days[index]);
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const deviation = Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length);
    const estimate = lastDay + Math.max(1, Math.round(mean));
    return {
      ...result, averageIntervalDays: mean, estimatedDate: dayString(estimate),
      rangeStart: dayString(lastDay + Math.max(1, Math.floor(mean - deviation))),
      rangeEnd: dayString(lastDay + Math.max(1, Math.ceil(mean + deviation))),
      overdueDays: Math.max(0, today - estimate),
    };
  }).sort((a, b) => {
    if (a.estimatedDate && b.estimatedDate) return a.estimatedDate.localeCompare(b.estimatedDate) || a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId);
    if (a.estimatedDate) return -1;
    if (b.estimatedDate) return 1;
    return a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId);
  });
}
