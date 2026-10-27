/**
 * Errores del tope por saldo del ERP (trigger enforce_erp_stock_cap, TRZ-100) traducidos para la pantalla.
 * Sin entorno ni red.
 */
import { formatStockQuantity } from "../erp-stock/types.ts";
import { isProductUnit } from "./units.ts";

export const ERP_STOCK_ERROR_CODES = { exceeded: "TF100", noBalance: "TF101", inactive: "TF102" } as const;

type DbError = { code?: string | null; details?: string | null } | null | undefined;

/** Mensaje en castellano para un error del tope, o null si el error es de otro tipo. */
export function erpStockErrorMessage(error: DbError): string | null {
  switch (error?.code) {
    case ERP_STOCK_ERROR_CODES.exceeded: {
      const detail = parseDetail(error.details);
      if (!detail) return "La cantidad supera el saldo disponible del lote en el ERP.";
      const where = `del lote ${detail.lot} en ${detail.warehouseCode}`;
      return detail.available > 0
        ? `La cantidad supera el saldo del ERP: quedan ${formatStockQuantity(detail.available, detail.unit)} disponibles ${where}.`
        : `No queda saldo disponible ${where} para armar pallets.`;
    }
    case ERP_STOCK_ERROR_CODES.noBalance:
      return "Ese lote no tiene saldo en el ERP para este depósito. Sincronizá con el ERP o elegí otro lote.";
    case ERP_STOCK_ERROR_CODES.inactive:
      return "El lote o su producto está inactivo en el ERP: no se pueden armar pallets.";
    default:
      return null;
  }
}

function parseDetail(details: string | null | undefined) {
  if (!details) return null;
  try {
    const value = JSON.parse(details) as Record<string, unknown>;
    const available = Number(value.available);
    const unit = String(value.unit);
    if (!Number.isFinite(available) || !isProductUnit(unit) || typeof value.lot !== "string" || typeof value.warehouseCode !== "string") {
      return null;
    }
    return { available, unit, lot: value.lot, warehouseCode: value.warehouseCode };
  } catch {
    return null;
  }
}
