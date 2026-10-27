/**
 * Errores del depósito al crear una ubicación o un pallet, o al ubicar un pallet (TRZ-101, trigger
 * default_warehouse_code y assign_pallet_location). Sin entorno ni red.
 */
export const WAREHOUSE_ERROR_CODES = {
  none: "TF110",
  choose: "TF111",
  inactive: "TF112",
  otherWarehouse: "TF113",
} as const;

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** Mensaje en castellano para un error de depósito, o null si el error es de otro tipo. */
export function warehouseErrorMessage(error: DbError): string | null {
  switch (error?.code) {
    case WAREHOUSE_ERROR_CODES.none:
      return "Tu empresa no tiene depósitos configurados. Pedí que los den de alta (o sincronizá con el ERP).";
    case WAREHOUSE_ERROR_CODES.choose:
      return "Tu empresa tiene varios depósitos: elegí en cuál.";
    case WAREHOUSE_ERROR_CODES.inactive:
      return "Ese depósito está inactivo: elegí otro.";
    case WAREHOUSE_ERROR_CODES.otherWarehouse:
      return "La ubicación es de otro depósito. Mover pallets entre depósitos no está disponible: elegí una ubicación del depósito del pallet.";
    case "23503":
      return /warehouse|depósito/i.test(error.message ?? "") ? "Ese depósito no existe en tu empresa. Actualizá la pantalla." : null;
    default:
      return null;
  }
}
