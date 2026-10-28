export type PalletScanDetails = {
  qr_code: string;
  product_name: string;
  product_sku: string;
  batch_number: string;
  quantity: number | null;
  unit_of_measure: string;
  physical_location: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
  actor_name: string | null;
  actor_role: string | null;
};

export type PalletScanResult = {
  pallet: PalletScanDetails | null;
  error: string | null;
};

const ACTIONS: Record<string, string> = {
  order_created: "Creación de orden",
  pallet_associated: "Asociación a una orden",
  pallet_dissociated: "Desasociación de una orden",
  qr_scan: "Validación de carga",
  dispatch_confirmed: "Despacho confirmado",
  reception: "Recepción",
  reception_discrepancy: "Diferencia en la recepción",
  location_update: "Actualización de ubicación",
  dispatch_discrepancy: "Diferencia en el despacho",
  delivery_confirmed: "Entrega confirmada",
  delivery_discrepancy: "Diferencia en la entrega",
  location_assigned: "Asignación de ubicación",
  location_changed: "Cambio de ubicación",
};

export function scanActionLabel(event: string): string {
  return ACTIONS[event] ?? "Movimiento registrado";
}

export function scanRoleLabel(role: string | null): string {
  switch (role) {
    case "logistics_manager": return "Logística";
    case "warehouse_operator": return "Operador de depósito";
    case "driver_operator": return "Chofer";
    default: return "Rol no disponible";
  }
}
