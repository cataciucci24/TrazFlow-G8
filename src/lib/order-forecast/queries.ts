import "server-only";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { forecastCustomerOrders, type ForecastCustomer, type ForecastOrder, type ForecastProductLine } from "./forecast";

type Db = Awaited<ReturnType<typeof createClient>>;
type One<T> = T | T[] | null;
type Product = { id: string; name: string; sku: string; unit_of_measure: string };
type PalletLine = {
  order_id: string;
  pallets: One<{ quantity: number | null; batches: One<{ products: One<Product> }> }>;
};
function first<T>(value: One<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
const PAGE_SIZE = 500;
const STATUSES = ["confirmed", "delivered", "delivered_with_discrepancy"];

/** Cada página tiene un orden estable: PostgREST limita por defecto a 1.000 filas. */
async function readPages<T>(query: (offset: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query(offset);
    if (error) throw new Error("No se pudo consultar el historial de despachos para estimar los próximos pedidos.", { cause: error });
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function shippedOrders(db: Db, companyId: string, now: string) {
  return db.from("dispatch_orders").select("id, distributor_id, confirmed_at, status")
    .eq("company_id", companyId).in("status", STATUSES).not("confirmed_at", "is", null).lte("confirmed_at", now)
    .order("id");
}

export async function getCustomerOrderForecasts() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) throw new Error("Solo logística puede consultar los próximos pedidos.");
  const db = await createClient();
  const now = new Date();
  const [customers, orders, palletLines] = await Promise.all([
    readPages<ForecastCustomer>((offset) => db.from("distributors").select("id, name").eq("company_id", profile.companyId)
      .order("id").range(offset, offset + PAGE_SIZE - 1)),
    readPages<{ id: string; distributor_id: string; confirmed_at: string; status: string }>((offset) =>
      shippedOrders(db, profile.companyId, now.toISOString()).range(offset, offset + PAGE_SIZE - 1)),
    readPages<PalletLine>((offset) => db.from("order_pallets")
      .select("order_id, pallet_id, dispatch_orders!inner(company_id, confirmed_at, status), pallets!inner(quantity, batches!inner(products!inner(id, name, sku, unit_of_measure)))")
      .eq("expected", true).eq("dispatch_orders.company_id", profile.companyId).eq("pallets.company_id", profile.companyId)
      .eq("pallets.batches.products.company_id", profile.companyId)
      .in("dispatch_orders.status", STATUSES).not("dispatch_orders.confirmed_at", "is", null).lte("dispatch_orders.confirmed_at", now.toISOString())
      .order("order_id").order("pallet_id").range(offset, offset + PAGE_SIZE - 1)),
  ]);
  const history: ForecastOrder[] = orders.map((order) => ({
    id: order.id, customerId: order.distributor_id, confirmedAt: order.confirmed_at, status: order.status,
  }));
  const lines: ForecastProductLine[] = palletLines.flatMap((line) => {
    const pallet = first(line.pallets);
    const product = first(first(pallet?.batches ?? null)?.products ?? null);
    return pallet && product ? [{
      orderId: line.order_id, productId: product.id, name: product.name, sku: product.sku,
      unit: product.unit_of_measure, quantity: pallet.quantity,
    }] : [];
  });
  return { forecasts: forecastCustomerOrders(customers, history, lines, now), calculatedAt: now.toISOString() };
}
