"use client";

import { activeWarehouses, warehouseLabel, type Warehouse } from "@/lib/warehouses/types";

/**
 * Selector de depósito (TRZ-101) para crear una ubicación o un pallet. Con un solo depósito activo no se muestra:
 * la base usa ese depósito, como antes. Manda `warehouseCode`.
 */
export function WarehouseField({ warehouses, disabled, className }: { warehouses: Warehouse[]; disabled?: boolean; className?: string }) {
  const active = activeWarehouses(warehouses);
  if (active.length <= 1) return null;
  return (
    <label className={`form-label ${className ?? ""}`}>
      Depósito
      <select name="warehouseCode" required defaultValue="" disabled={disabled} className="form-control mt-2 font-normal">
        <option value="" disabled>Seleccioná el depósito</option>
        {active.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouseLabel(warehouse)}</option>)}
      </select>
    </label>
  );
}
