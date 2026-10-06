import type { ProductUnit } from "@/lib/pallets/units";
import { createClient } from "@/lib/supabase/server";
import { calculateStockDays, getStockRiskLevel } from "@/lib/stock-alerts/queries";
import type { DistributorBatchStock, DistributorStockEntry } from "@/lib/types";

export type StockReportingDistributor = { id: string; name: string };
export type StockReportingBatch = { id: string; batchNumber: string; expirationDate: string | null };
export type StockReportingProduct = { id: string; name: string; sku: string; unitOfMeasure: ProductUnit; batches: StockReportingBatch[] };

type RawBatch = { id: string; batch_number: string; expiration_date: string | null };

type RawProduct = { id: string; name: string; sku: string; unit_of_measure: ProductUnit; batches: RawBatch[] | null };

type RawBatchStock = {
  batch_id: string;
  quantity: number;
  batches: Omit<RawBatch, "id"> | Omit<RawBatch, "id">[] | null;
};

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
  products: Pick<RawProduct, "name" | "sku" | "unit_of_measure"> | Pick<RawProduct, "name" | "sku" | "unit_of_measure">[] | null;
  distributor_batch_stocks: RawBatchStock[] | null;
};

export type StockReportingData = {
  distributor: StockReportingDistributor | null;
  products: StockReportingProduct[];
  entries: DistributorStockEntry[];
  sourceAvailable: boolean;
};

/** Primero el que vence antes; los lotes sin fecha, al final. */
function byExpiration(first: { expirationDate: string | null }, second: { expirationDate: string | null }) {
  return (first.expirationDate ?? "9999-12-31").localeCompare(second.expirationDate ?? "9999-12-31");
}

export async function getStockReportingData(userId: string, companyId: string): Promise<StockReportingData> {
  const supabase = await createClient();
  const [distributorsResult, productsResult, entriesResult] = await Promise.all([
    supabase
      .from("distributor_users")
      .select("distributor_id, distributors ( name )")
      .eq("user_id", userId),
    supabase
      .from("products")
      .select("id, name, sku, unit_of_measure, batches ( id, batch_number, expiration_date )")
      .eq("company_id", companyId)
      .order("name"),
    supabase
      .from("distributor_product_stocks")
      .select("id, distributor_id, product_id, current_stock, daily_consumption, updated_at, distributors ( name ), products ( name, sku, unit_of_measure ), distributor_batch_stocks ( batch_id, quantity, batches ( batch_number, expiration_date ) )")
      .order("updated_at", { ascending: false }),
  ]);

  // PGRST205: falta la tabla de stock; PGRST200: falta la de lotes (TRZ-90). La app puede llegar antes que la migración.
  if (entriesResult.error?.code === "PGRST205" || entriesResult.error?.code === "PGRST200") {
    return { distributor: null, products: [], entries: [], sourceAvailable: false };
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
    const stockDays = calculateStockDays(row.current_stock, row.daily_consumption);
    return {
      id: row.id,
      distributorId: row.distributor_id,
      distributorName: distributor?.name ?? "Distribuidora",
      productId: row.product_id,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
      currentStock: row.current_stock,
      dailyConsumption: row.daily_consumption,
      unitOfMeasure: product?.unit_of_measure ?? "unidades",
      stockDays,
      riskLevel: getStockRiskLevel(stockDays),
      updatedAt: row.updated_at,
      batches: (row.distributor_batch_stocks ?? []).map((stock): DistributorBatchStock => {
        const batch = Array.isArray(stock.batches) ? stock.batches[0] : stock.batches;
        return {
          batchId: stock.batch_id,
          batchNumber: batch?.batch_number ?? "—",
          expirationDate: batch?.expiration_date ?? null,
          quantity: stock.quantity,
        };
      }).sort(byExpiration),
    };
  });

  return {
    distributor: distributors.length === 1 ? distributors[0] : null,
    products: ((productsResult.data ?? []) as RawProduct[]).map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      unitOfMeasure: product.unit_of_measure,
      batches: (product.batches ?? [])
        .map((batch) => ({ id: batch.id, batchNumber: batch.batch_number, expirationDate: batch.expiration_date }))
        .sort(byExpiration),
    })),
    entries,
    sourceAvailable: true,
  };
}
