import { createClient } from "@/lib/supabase/server";
import type { DistributorStockAlert, StockRiskLevel } from "@/lib/types";

type RelatedRecord = { name: string; sku?: string } | { name: string; sku?: string }[] | null;

type RawStockRow = {
  id: string;
  current_stock: number;
  daily_consumption: number;
  distributors: RelatedRecord;
  products: RelatedRecord;
};

export type StockAlertsResult = {
  alerts: DistributorStockAlert[];
  inventorySourceAvailable: boolean;
};

/** Días de cobertura disponibles para un producto. El consumo diario debe ser mayor a cero. */
export function calculateStockDays(currentStock: number, dailyConsumption: number): number {
  return currentStock / dailyConsumption;
}

/** Clasifica la cobertura. Valores sobre 14 días no generan alerta. */
export function getStockRiskLevel(stockDays: number): StockRiskLevel | null {
  if (stockDays <= 7) return "critical";
  if (stockDays <= 14) return "caution";
  return null;
}

/** Alertas vigentes de cobertura de stock para la empresa indicada. */
export async function getDistributorStockAlerts(companyId: string): Promise<StockAlertsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("distributor_product_stocks")
    .select("id, current_stock, daily_consumption, distributors ( name ), products ( name, sku )")
    .eq("company_id", companyId);

  if (error) {
    // Durante un despliegue la app puede llegar antes que esta migración.
    // En ese caso mostramos un estado controlado en lugar de romper el panel.
    if (error.code === "PGRST205") {
      return { alerts: [], inventorySourceAvailable: false };
    }

    throw new Error(`No se pudieron cargar las alertas de stock (${error.code}: ${error.message}).`, { cause: error });
  }

  const alerts = ((data ?? []) as RawStockRow[])
    .map((row) => {
      const distributor = Array.isArray(row.distributors) ? row.distributors[0] : row.distributors;
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      const stockDays = calculateStockDays(row.current_stock, row.daily_consumption);
      const riskLevel = getStockRiskLevel(stockDays);

      if (!riskLevel) return null;

      return {
        id: row.id,
        distributorName: distributor?.name ?? "—",
        productName: product?.name ?? "—",
        productSku: product?.sku ?? "—",
        currentStock: row.current_stock,
        dailyConsumption: row.daily_consumption,
        stockDays,
        riskLevel,
      };
    })
    .filter((alert): alert is DistributorStockAlert => alert !== null)
    .sort((first, second) => first.stockDays - second.stockDays);

  return { alerts, inventorySourceAvailable: true };
}
