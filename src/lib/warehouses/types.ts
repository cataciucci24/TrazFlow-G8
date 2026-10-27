/**
 * Depósitos de TrazFlow (TRZ-101, tabla warehouses). Sin entorno ni red: seguro para componentes cliente.
 *
 * Una empresa sin ERP tiene los depósitos que se cargaron en el onboarding (las que ya existían, DEP-01). Con ERP,
 * la sincronización trae los suyos. `code` es lo que guardan ubicaciones, pallets y saldos, y no cambia nunca.
 */
export type Warehouse = {
  code: string;
  name: string;
  /** Id del depósito en el ERP, o null si se cargó en TrazFlow. */
  externalId: string | null;
  sourceSystem: "trazflow" | "erp";
  /** false = el ERP lo deshabilitó o dejó de informarlo. No se ofrece para ubicaciones ni pallets nuevos. */
  active: boolean;
  syncedAt: string | null;
};

export function toWarehouse(row: {
  code: string;
  name: string;
  external_id: string | null;
  source_system: "trazflow" | "erp";
  active: boolean;
  synced_at: string | null;
}): Warehouse {
  return {
    code: row.code,
    name: row.name,
    externalId: row.external_id,
    sourceSystem: row.source_system,
    active: row.active,
    syncedAt: row.synced_at,
  };
}

/** Depósitos donde se pueden crear ubicaciones y pallets. */
export function activeWarehouses(warehouses: Warehouse[]): Warehouse[] {
  return warehouses.filter((warehouse) => warehouse.active);
}

/** "DEP-01 · Depósito Central". Si el nombre es el código, solo el código. */
export function warehouseLabel(warehouse: Pick<Warehouse, "code" | "name">): string {
  return warehouse.name && warehouse.name !== warehouse.code ? `${warehouse.code} · ${warehouse.name}` : warehouse.code;
}
