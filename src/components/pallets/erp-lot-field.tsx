"use client";

import { useState } from "react";

import { InlineAlert } from "@/components/ui/design-system";
import {
  awaitingDocumentWarning,
  canBuildFrom,
  documentLabelText,
  formatStockQuantity,
  type ErpStockRow,
} from "@/lib/erp-stock/types";

/**
 * Selector de lote del ERP para armar un pallet (TRZ-100): producto, lote y disponible. Solo se pueden elegir
 * lotes activos, de productos activos y con saldo disponible. Los avisos del remito no bloquean.
 */
export function ErpLotField({ lots, onChange }: { lots: ErpStockRow[]; onChange: (lot: ErpStockRow | null) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = lots.find((lot) => lot.batchId === selectedId) ?? null;
  const buildable = lots.filter(canBuildFrom);
  const label = selected ? documentLabelText(selected) : null;
  const warning = selected ? awaitingDocumentWarning(selected) : null;

  return (
    <div className="grid min-w-0 gap-2 sm:col-span-2">
      <label className="form-label">
        Lote del ERP
        <select
          required
          name="batchId"
          value={selectedId}
          disabled={buildable.length === 0}
          onChange={(event) => {
            setSelectedId(event.target.value);
            onChange(lots.find((lot) => lot.batchId === event.target.value) ?? null);
          }}
          className="form-control mt-2 font-normal"
        >
          <option value="" disabled>{buildable.length ? "Seleccioná producto y lote" : "No hay lotes con saldo disponible"}</option>
          {lots.map((lot) => (
            <option key={`${lot.batchId}:${lot.warehouseCode}`} value={lot.batchId} disabled={!canBuildFrom(lot)}>
              {lot.productName} · {lot.batchNumber} · disponible {formatStockQuantity(Math.max(lot.available, 0), lot.unitOfMeasure)}
              {!lot.lotActive || !lot.productActive ? " (inactivo en el ERP)" : ""}
            </option>
          ))}
        </select>
      </label>
      {buildable.length === 0 ? (
        <p className="text-xs text-stone-500">Sincronizá con el ERP para traer los saldos, o revisá &quot;Stock según ERP&quot;.</p>
      ) : null}
      {selected ? (
        <p className="text-xs text-stone-600">
          Saldo en el ERP {formatStockQuantity(selected.erpQuantity, selected.unitOfMeasure)} · armado {formatStockQuantity(selected.built, selected.unitOfMeasure)}
          {selected.dispatchedPending > 0 ? ` · despachado sin descontar ${formatStockQuantity(selected.dispatchedPending, selected.unitOfMeasure)}` : ""}
          {" · "}depósito {selected.warehouseCode}
        </p>
      ) : null}
      {label || warning ? (
        <InlineAlert variant="warning" announce={false}>
          {[label, warning].filter(Boolean).join(". ")}
        </InlineAlert>
      ) : null}
    </div>
  );
}
