import { attachExpectedPalletContents, type ExpectedPalletRelation } from "../pallets/contents";
import "server-only";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { forecastCustomerOrders, type ForecastCustomer, type ForecastOrder, type ForecastProductLine } from "./forecast";

type Db = Awaited<ReturnType<typeof createClient>>;
type PalletLine = ExpectedPalletRelation & { order_id: string };
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
      .select("order_id, pallet_id, expected_items, dispatch_orders!inner(company_id, confirmed_at, status)")
      .eq("expected", true).eq("dispatch_orders.company_id", profile.companyId)
      .in("dispatch_orders.status", STATUSES).not("dispatch_orders.confirmed_at", "is", null).lte("dispatch_orders.confirmed_at", now.toISOString())
      .order("order_id").order("pallet_id").range(offset, offset + PAGE_SIZE - 1)),
  ]);
  const history: ForecastOrder[] = orders.map((order) => ({
    id: order.id, customerId: order.distributor_id, confirmedAt: order.confirmed_at, status: order.status,
  }));
  const contents = await attachExpectedPalletContents(db, palletLines);
  const lines: ForecastProductLine[] = contents.flatMap((line) =>
    line.contents.map((item) => ({
      orderId: line.order_id, productId: item.productId, name: item.productName, sku: item.productSku,
      unit: item.unitOfMeasure, quantity: item.quantity,
    })));
  return { forecasts: forecastCustomerOrders(customers, history, lines, now), calculatedAt: now.toISOString() };
}
