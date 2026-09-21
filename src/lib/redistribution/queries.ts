import type { PalletUnit } from "@/lib/pallets/units";
import type { StalePallet } from "@/lib/pallets/queries";
import { suggestRedistributions } from "@/lib/redistribution/suggest";
import type { DistributorCoverageInput, RedistributionSuggestion } from "@/lib/redistribution/suggest";
import { calculateStockDays, getStockRiskLevel } from "@/lib/stock-alerts/queries";
import { createClient } from "@/lib/supabase/server";

type RelatedRecord = { name: string; sku?: string } | { name: string; sku?: string }[] | null;

type RawCoverageRow = {
  current_stock: number;
  daily_consumption: number;
  unit_of_measure: PalletUnit;
  distributors: RelatedRecord;
  products: RelatedRecord;
};

export type RedistributionSuggestionsResult = {
  suggestions: RedistributionSuggestion[];
  stockSourceAvailable: boolean;
};

/** Sugerencias para mover mercadería inmovilizada hacia distribuidoras con faltante del mismo producto. */
export async function getRedistributionSuggestions(
  companyId: string,
  stalePallets: StalePallet[],
): Promise<RedistributionSuggestionsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("distributor_product_stocks")
    .select("current_stock, daily_consumption, unit_of_measure, distributors ( name ), products ( name, sku )")
    .eq("company_id", companyId);

  if (error) {
    // Mismo criterio que las alertas de stock: la app puede desplegarse antes que la migración.
    if (error.code === "PGRST205") {
      return { suggestions: [], stockSourceAvailable: false };
    }

    throw new Error(`No se pudo cargar el stock de las distribuidoras (${error.code}: ${error.message}).`, { cause: error });
  }

  const coverages = ((data ?? []) as RawCoverageRow[]).map((row): DistributorCoverageInput => {
    const distributor = Array.isArray(row.distributors) ? row.distributors[0] : row.distributors;
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const stockDays = calculateStockDays(row.current_stock, row.daily_consumption);

    return {
      distributorName: distributor?.name ?? "—",
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
      currentStock: row.current_stock,
      dailyConsumption: row.daily_consumption,
      unitOfMeasure: row.unit_of_measure,
      stockDays,
      riskLevel: getStockRiskLevel(stockDays),
    };
  });

  return { suggestions: suggestRedistributions(stalePallets, coverages), stockSourceAvailable: true };
}
