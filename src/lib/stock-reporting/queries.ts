import { createClient } from "@/lib/supabase/server";
import type { DistributorStockEntry } from "@/lib/types";

export type StockReportingDistributor = { id: string; name: string };
export type StockReportingProduct = { id: string; name: string; sku: string };

type RawDistributorUser = {
  distributor_id: string;
  distributors: { name: string } | { name: string }[] | null;
};

type RawStockEntry = {
  id: string;
  distributor_id: string;
  product_id: string;
  current_stock: number;
  daily_consumption: number;
  updated_at: string;
  distributors: { name: string } | { name: string }[] | null;
  products: { name: string; sku: string } | { name: string; sku: string }[] | null;
};

export type StockReportingData = {
  distributors: StockReportingDistributor[];
  products: StockReportingProduct[];
  entries: DistributorStockEntry[];
  sourceAvailable: boolean;
};

export async function getStockReportingData(userId: string, companyId: string): Promise<StockReportingData> {
  const supabase = await createClient();
  const [distributorsResult, productsResult, entriesResult] = await Promise.all([
    supabase
      .from("distributor_users")
      .select("distributor_id, distributors ( name )")
      .eq("user_id", userId),
    supabase
      .from("products")
      .select("id, name, sku")
      .eq("company_id", companyId)
      .order("name"),
    supabase
      .from("distributor_product_stocks")
      .select("id, distributor_id, product_id, current_stock, daily_consumption, updated_at, distributors ( name ), products ( name, sku )")
      .order("updated_at", { ascending: false }),
  ]);

  if (entriesResult.error?.code === "PGRST205") {
    return { distributors: [], products: [], entries: [], sourceAvailable: false };
  }

  const firstError = distributorsResult.error ?? productsResult.error ?? entriesResult.error;
  if (firstError) {
    throw new Error(`No se pudieron cargar los datos de stock (${firstError.code}: ${firstError.message}).`, { cause: firstError });
  }

  const distributors = ((distributorsResult.data ?? []) as RawDistributorUser[]).map((row) => {
    const distributor = Array.isArray(row.distributors) ? row.distributors[0] : row.distributors;
    return { id: row.distributor_id, name: distributor?.name ?? "Distribuidora" };
  });

  const entries = ((entriesResult.data ?? []) as RawStockEntry[]).map((row) => {
    const distributor = Array.isArray(row.distributors) ? row.distributors[0] : row.distributors;
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      id: row.id,
      distributorId: row.distributor_id,
      distributorName: distributor?.name ?? "Distribuidora",
      productId: row.product_id,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
      currentStock: row.current_stock,
      dailyConsumption: row.daily_consumption,
      updatedAt: row.updated_at,
    };
  });

  return {
    distributors,
    products: (productsResult.data ?? []) as StockReportingProduct[],
    entries,
    sourceAvailable: true,
  };
}
