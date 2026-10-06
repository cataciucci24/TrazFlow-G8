import type { ProductUnit } from "../pallets/units.ts";
import type { PalletStatus, StockRiskLevel } from "../types.ts";

/** Cobertura objetivo, en días, que se busca alcanzar en la distribuidora que recibe. */
export const TARGET_COVERAGE_DAYS = 30;

/** Pallet inmovilizado que puede ser candidato a redistribuirse. Su cantidad está en la unidad del producto. */
export type StagnantPalletInput = {
  id: string;
  qrCode: string;
  status: PalletStatus;
  productName: string;
  productSku: string;
  quantity: number | null;
  daysWithoutMovement: number;
};

/** Stock informado por una distribuidora para un producto, con su cobertura ya calculada. */
export type DistributorCoverageInput = {
  distributorName: string;
  productName: string;
  productSku: string;
  currentStock: number;
  dailyConsumption: number;
  unitOfMeasure: ProductUnit;
  stockDays: number;
  riskLevel: StockRiskLevel | null;
};

export type SuggestedPallet = {
  id: string;
  qrCode: string;
  quantity: number;
  daysWithoutMovement: number;
};

/**
 * Sugerencia informativa: la distribuidora tiene poca cobertura de un producto
 * del que hay pallets inmovilizados en el depósito. Pallets y stock de la
 * distribuidora están en la unidad del producto, así que siempre se pueden sumar.
 */
export type RedistributionSuggestion = {
  distributorName: string;
  productName: string;
  productSku: string;
  riskLevel: StockRiskLevel;
  currentStockDays: number;
  /** Unidad del producto. */
  unitOfMeasure: ProductUnit;
  pallets: SuggestedPallet[];
  /** Suma de los pallets sugeridos. */
  suggestedQuantity: number;
  /** Cobertura que tendría la distribuidora al recibirlos. */
  stockDaysAfter: number;
};

/**
 * Empareja mercadería inmovilizada en depósito con distribuidoras con faltante del mismo producto (SKU).
 *
 * - Solo se consideran pallets `in_warehouse` con cantidad definida: los demás ya están
 *   comprometidos o entregados, o no se pueden cuantificar.
 * - Se atiende primero a la distribuidora con menos cobertura y los pallets ya usados no se repiten.
 * - Se envían pallets completos, del más antiguo al más nuevo, hasta cubrir lo necesario para
 *   llegar a `TARGET_COVERAGE_DAYS`. El último pallet puede pasarse un poco de ese objetivo.
 */
export function suggestRedistributions(
  pallets: StagnantPalletInput[],
  coverages: DistributorCoverageInput[],
): RedistributionSuggestion[] {
  const remainingBySku = new Map<string, QuantifiedPallet[]>();
  for (const pallet of pallets) {
    if (pallet.status !== "in_warehouse" || !isQuantified(pallet)) continue;
    const group = remainingBySku.get(pallet.productSku) ?? [];
    group.push(pallet);
    remainingBySku.set(pallet.productSku, group);
  }
  for (const group of remainingBySku.values()) {
    group.sort((left, right) => right.daysWithoutMovement - left.daysWithoutMovement);
  }

  const shortages = coverages
    .filter((coverage): coverage is DistributorCoverageInput & { riskLevel: StockRiskLevel } =>
      coverage.riskLevel !== null && remainingBySku.has(coverage.productSku))
    .sort((left, right) => left.stockDays - right.stockDays);

  const suggestions: RedistributionSuggestion[] = [];

  for (const coverage of shortages) {
    const available = remainingBySku.get(coverage.productSku) ?? [];
    if (available.length === 0) continue;

    const needed = Math.max(0, TARGET_COVERAGE_DAYS * coverage.dailyConsumption - coverage.currentStock);
    const chosen: QuantifiedPallet[] = [];
    let accumulated = 0;
    for (const pallet of available) {
      if (accumulated >= needed) break;
      chosen.push(pallet);
      accumulated += pallet.quantity;
    }

    const chosenIds = new Set(chosen.map((pallet) => pallet.id));
    remainingBySku.set(coverage.productSku, available.filter((pallet) => !chosenIds.has(pallet.id)));

    suggestions.push({
      distributorName: coverage.distributorName,
      productName: coverage.productName,
      productSku: coverage.productSku,
      riskLevel: coverage.riskLevel,
      currentStockDays: coverage.stockDays,
      unitOfMeasure: coverage.unitOfMeasure,
      pallets: chosen.map(toSuggestedPallet),
      suggestedQuantity: accumulated,
      stockDaysAfter: (coverage.currentStock + accumulated) / coverage.dailyConsumption,
    });
  }

  return suggestions;
}

type QuantifiedPallet = StagnantPalletInput & { quantity: number };

function isQuantified(pallet: StagnantPalletInput): pallet is QuantifiedPallet {
  return pallet.quantity !== null;
}

function toSuggestedPallet(pallet: QuantifiedPallet): SuggestedPallet {
  return {
    id: pallet.id,
    qrCode: pallet.qrCode,
    quantity: pallet.quantity,
    daysWithoutMovement: pallet.daysWithoutMovement,
  };
}
