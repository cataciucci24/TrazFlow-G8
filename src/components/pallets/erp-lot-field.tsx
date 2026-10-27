"use client";

import { useState } from "react";

import { canBuildFrom, formatStockQuantity, type ErpStockRow } from "@/lib/erp-stock/types";
import { warehouseLabel, type Warehouse } from "@/lib/warehouses/types";

/** Clave de una fila: el mismo lote puede tener saldo en dos depósitos (TRZ-101). */
function rowKey(lot: Pick<ErpStockRow, "batchId" | "warehouseCode">): string {
  return `${lot.batchId}|${lot.warehouseCode}`;
}

/**
 * Selector de lote del ERP para armar un pallet (TRZ-100): producto, lote y disponible, por depósito (TRZ-101).
 * Solo se pueden elegir lotes activos, de productos activos y con saldo disponible. El disponible ya descuenta lo
 * despachado que el ERP todavía no descontó, así que el estado del remito no se muestra acá (se ve en Integración
 * ERP). Manda `batchId` y `warehouseCode`: el pallet queda en el depósito del saldo elegido.
 */
export function ErpLotField({ lots, warehouses = [], onChange }: {
  lots: ErpStockRow[];
  warehouses?: Warehouse[];
  onChange: (lot: ErpStockRow | null) => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const selected = lots.find((lot) => rowKey(lot) === selectedKey) ?? null;
  const buildable = lots.filter(canBuildFrom);
  const severalWarehouses = new Set(lots.map((lot) => lot.warehouseCode)).size > 1;
  const label = (code: string) => {
    const warehouse = warehouses.find((candidate) => candidate.code === code);
    return warehouse ? warehouseLabel(warehouse) : code;
  };

  return (
    <div className="grid min-w-0 gap-2 sm:col-span-2">
      <label className="form-label">
        Lote del ERP
        <select
          required
          value={selectedKey}
          disabled={buildable.length === 0}
          onChange={(event) => {
            setSelectedKey(event.target.value);
            onChange(lots.find((lot) => rowKey(lot) === event.target.value) ?? null);
          }}
          className="form-control mt-2 font-normal"
        >
          <option value="" disabled>{buildable.length ? "Seleccioná producto y lote" : "No hay lotes con saldo disponible"}</option>
          {lots.map((lot) => (
            <option key={rowKey(lot)} value={rowKey(lot)} disabled={!canBuildFrom(lot)}>
              {lot.productName} · {lot.batchNumber}{severalWarehouses ? ` · ${label(lot.warehouseCode)}` : ""} · disponible {formatStockQuantity(Math.max(lot.available, 0), lot.unitOfMeasure)}
              {!lot.lotActive || !lot.productActive ? " (inactivo en el ERP)" : ""}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="batchId" value={selected?.batchId ?? ""} />
      <input type="hidden" name="warehouseCode" value={selected?.warehouseCode ?? ""} />
      {buildable.length === 0 ? (
        <p className="text-xs text-stone-500">Sincronizá con el ERP para traer los saldos, o revisá &quot;Stock según ERP&quot;.</p>
      ) : null}
      {selected ? (
        <p className="text-xs text-stone-600">
          Saldo en el ERP {formatStockQuantity(selected.erpQuantity, selected.unitOfMeasure)} · armado {formatStockQuantity(selected.built, selected.unitOfMeasure)}
          {selected.dispatchedPending > 0 ? ` · despachado sin descontar ${formatStockQuantity(selected.dispatchedPending, selected.unitOfMeasure)}` : ""}
          {" · "}depósito {label(selected.warehouseCode)}
        </p>
      ) : null}
    </div>
  );
}
