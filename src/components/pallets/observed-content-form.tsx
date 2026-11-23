"use client";

import { useState } from "react";
import type { ObservedPalletItem } from "@/lib/pallets/item-input";

/** El operador confirma lo detectado; producto, lote y cantidad son editables. */
export function ObservedContentForm({ expected, pending, onConfirm, label = "Comparar y confirmar" }: {
  expected: ObservedPalletItem[];
  pending: boolean;
  onConfirm: (items: ObservedPalletItem[]) => void;
  label?: string;
}) {
  const [items, setItems] = useState(expected.map((item, key) => ({ ...item, key })));
  const [nextKey, setNextKey] = useState(items.length);
  return <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); if (!pending) onConfirm(items.map(({ productSku, batchNumber, quantity }) => ({ productSku, batchNumber, quantity }))); }}>
    <p className="text-sm text-stone-600">Compará cada producto, lote y cantidad con el contenido físico. Corregí los datos detectados si hay diferencias; quitá faltantes y agregá sobrantes.</p>
    {items.map((item, index) => <fieldset key={item.key} disabled={pending} className="grid gap-2 border-b pb-3 sm:grid-cols-3">
      <legend className="mb-2 font-semibold">Ítem detectado {index + 1}</legend>
      <label className="form-label">SKU<input className="form-control mt-1" required value={item.productSku} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, productSku: event.target.value } : row))} /></label>
      <label className="form-label">Lote<input className="form-control mt-1" required value={item.batchNumber} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, batchNumber: event.target.value } : row))} /></label>
      <label className="form-label">Cantidad<input className="form-control mt-1" type="number" min="0" step="0.01" required={item.quantity !== null} value={item.quantity ?? ""} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, quantity: event.target.value === "" ? null : Number(event.target.value) } : row))} /></label>
      <button type="button" className="button-secondary button-sm sm:col-span-3" onClick={() => setItems(items.filter((row) => row.key !== item.key))}>Quitar ítem {index + 1}</button>
    </fieldset>)}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="button-secondary" disabled={pending || items.length >= 100} onClick={() => { setItems([...items, { key: nextKey, productSku: "", batchNumber: "", quantity: 0 }]); setNextKey(nextKey + 1); }}>Agregar ítem detectado</button>
      <button className="button-primary" disabled={pending}>{pending ? "Registrando…" : label}</button>
    </div>
  </form>;
}
