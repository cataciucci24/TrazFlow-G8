"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InlineAlert } from "@/components/ui/design-system";
import { createPalletWithItems } from "@/lib/pallets/item-actions";
import { quantityStep } from "@/lib/pallets/units";
import { canBuildFrom, type ErpStockRow } from "@/lib/erp-stock/types";
import type { Lot } from "@/lib/types";
import { warehouseLabel, type Warehouse } from "@/lib/warehouses/types";

export function MixedPalletForm({ lots, warehouses, erpLots }: { lots: Lot[]; warehouses: Warehouse[]; erpLots?: ErpStockRow[] }) {
  const router = useRouter();
  const active = warehouses.filter((warehouse) => warehouse.active);
  const [warehouse, setWarehouse] = useState(active.length === 1 ? active[0].code : "");
  const [items, setItems] = useState([{ key: 0, batchId: "", quantity: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const [state, setState] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });
  const [pending, startTransition] = useTransition();
  const options = erpLots === undefined ? lots : lots.filter((lot) => erpLots.some((stock) => stock.batchId === lot.id && stock.warehouseCode === warehouse && canBuildFrom(stock)));
  return <form className="surface grid gap-5 p-5" onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await createPalletWithItems(items.map((item) => ({ batch_id: item.batchId, quantity: Number(item.quantity) })), warehouse);
        setState(result);
        if (result.success) { setItems([{ key: nextKey, batchId: "", quantity: "" }]); setNextKey(nextKey + 1); router.refresh(); }
      } catch { setState({ error: "No se pudo armar el pallet. Intentá nuevamente.", success: null }); }
    });
  }}>
    {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
    {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
    <label className="form-label">Depósito<select className="form-control mt-2" required disabled={pending} value={warehouse} onChange={(event) => { setWarehouse(event.target.value); if (erpLots) setItems(items.map((item) => ({ ...item, batchId: "" }))); }}>
      <option value="">Seleccioná un depósito</option>{active.map((value) => <option key={value.code} value={value.code}>{warehouseLabel(value)}</option>)}
    </select></label>
    <p className="text-sm text-stone-500">Agregá uno o varios productos y lotes. Cada cantidad usa la unidad de su producto; todos los ítems comparten el depósito y el QR.</p>
    {items.map((item, index) => {
      const lot = lots.find((candidate) => candidate.id === item.batchId);
      const stock = erpLots?.find((candidate) => candidate.batchId === item.batchId && candidate.warehouseCode === warehouse);
      return <fieldset key={item.key} disabled={pending} className="grid gap-3 border-b border-stone-200 pb-4 sm:grid-cols-[1fr_150px_auto]">
        <legend className="mb-2 font-semibold">Ítem {index + 1}</legend>
        <label className="form-label">Producto y lote<select className="form-control mt-2" required value={item.batchId} onChange={(event) => setItems(items.map((value) => value.key === item.key ? { ...value, batchId: event.target.value, quantity: "" } : value))}>
          <option value="">Seleccioná un lote</option>{options.map((value) => <option key={value.id} value={value.id} disabled={items.some((other) => other.key !== item.key && other.batchId === value.id)}>{value.productName} ({value.productSku}) · {value.batchNumber}</option>)}
        </select></label>
        <label className="form-label">Cantidad {lot && `(${lot.unitOfMeasure})`}<input className="form-control mt-2" type="number" required min={quantityStep(lot?.unitOfMeasure ?? null)} step={quantityStep(lot?.unitOfMeasure ?? null)} max={stock?.available} value={item.quantity} onChange={(event) => setItems(items.map((value) => value.key === item.key ? { ...value, quantity: event.target.value } : value))} /></label>
        <button type="button" className="button-secondary self-end" disabled={items.length === 1} onClick={() => setItems(items.filter((value) => value.key !== item.key))}>Quitar ítem {index + 1}</button>
        {stock && <p className="text-sm text-stone-500 sm:col-span-3">Disponible: {stock.available} {stock.unitOfMeasure}</p>}
      </fieldset>;
    })}
    <div className="flex flex-wrap gap-3">
      <button type="button" className="button-secondary" disabled={pending || items.length >= 100} onClick={() => { setItems([...items, { key: nextKey, batchId: "", quantity: "" }]); setNextKey(nextKey + 1); }}>Agregar ítem</button>
      <button className="button-primary" disabled={pending || options.length === 0}>{pending ? "Armando…" : "Armar pallet con un único QR"}</button>
    </div>
  </form>;
}
