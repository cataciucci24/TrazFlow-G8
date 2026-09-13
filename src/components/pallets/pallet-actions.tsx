"use client";

import { useActionState, useState, useTransition } from "react";

import { deletePallet, updatePallet, type UpdatePalletState } from "@/lib/pallets/actions";
import type { Pallet } from "@/lib/types";

const INITIAL_STATE: UpdatePalletState = { error: null, success: null };

export function PalletActions({ pallet }: { pallet: Pallet }) {
  const updateForPallet = updatePallet.bind(null, pallet.id);
  const [state, formAction, isPending] = useActionState(updateForPallet, INITIAL_STATE);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{ error: string | null; success: string | null } | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const mayDelete = pallet.status === "in_warehouse";

  function handleDelete() {
    if (!window.confirm(`¿Eliminar el pallet ${pallet.qrCode}? Esta acción no se puede deshacer.`)) return;
    startDeleting(async () => setDeleteState(await deletePallet(pallet.id)));
  }

  return <div className="inline-flex flex-col items-end gap-2"><details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)} className="relative text-left"><summary className="cursor-pointer list-none rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-stone-700 hover:border-amber-400 hover:text-amber-700">Editar</summary><form action={formAction} className="absolute right-0 z-20 mt-2 grid w-80 gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl"><div><h3 className="font-bold">Editar pallet</h3><p className="mt-1 text-xs text-stone-500">Actualizá su identificación, lote o ubicación.</p></div>{state.error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{state.error}</p>}{state.success && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</p>}<PalletField label="Código QR" name="qrCode" defaultValue={pallet.qrCode} /><PalletField label="Producto" name="productName" defaultValue={pallet.productName} /><PalletField label="SKU" name="productSku" defaultValue={pallet.productSku} /><PalletField label="Lote" name="batchNumber" defaultValue={pallet.batchNumber} /><PalletField label="Cantidad" name="quantity" type="number" defaultValue={String(pallet.quantity)} /><PalletField label="Ubicación" name="currentLocation" defaultValue={pallet.currentLocation ?? "Depósito"} required={false} /><button disabled={isPending} className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-60">{isPending ? "Guardando..." : "Guardar cambios"}</button></form></details>{mayDelete ? <button type="button" disabled={isDeleting} onClick={handleDelete} className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-60">{isDeleting ? "Eliminando..." : "Eliminar"}</button> : <span title="Solo se pueden eliminar pallets en depósito" className="text-xs text-stone-400">No eliminable</span>}{deleteState?.error && <span role="alert" className="max-w-36 text-right text-xs text-red-600">{deleteState.error}</span>}</div>;
}

function PalletField({ label, name, defaultValue, type = "text", required = true }: { label: string; name: string; defaultValue: string; type?: string; required?: boolean }) {
  return <label className="text-xs font-bold uppercase tracking-wide text-stone-500">{label}<input required={required} name={name} type={type} min={type === "number" ? 0 : undefined} defaultValue={defaultValue} className="mt-1.5 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-amber-500" /></label>;
}
