"use client";

import { UnitOfMeasureField } from "@/components/pallets/unit-of-measure-field";
import { LotField } from "@/components/pallets/lot-field";
import { ProductField } from "@/components/pallets/product-field";

import { useEffect, useRef, useState, useTransition } from "react";

import { deletePallet, updatePallet, type UpdatePalletState } from "@/lib/pallets/actions";
import type { ExistingProduct, Pallet, ProductBatch } from "@/lib/types";

const INITIAL_STATE: UpdatePalletState = { error: null, success: null };

export function PalletActions({
  pallet,
  existingBatches,
  existingProducts,
}: {
  pallet: Pallet;
  existingBatches: ProductBatch[];
  existingProducts: ExistingProduct[];
}) {
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [productSku, setProductSku] = useState(pallet.productSku);
  const [deleteState, setDeleteState] = useState<{ error: string | null; success: string | null } | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mayDelete = pallet.status === "in_warehouse";

  function handleDelete() {
    if (!window.confirm(`¿Eliminar el pallet ${pallet.qrCode}? Esta acción no se puede deshacer.`)) return;
    startDeleting(async () => setDeleteState(await deletePallet(pallet.id)));
  }

  function handleSubmitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(async () => {
      const nextState = await updatePallet(pallet.id, state, new FormData(form));
      setState(nextState);
      if (nextState.success) setIsOpen(false);
    });
  }

  function closeForm() {
    setIsOpen(false);
    formRef.current?.reset();
    setProductSku(pallet.productSku);
    setState(INITIAL_STATE);
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        closeForm();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return <div className="inline-flex flex-col items-end gap-2"><details ref={detailsRef} open={isOpen} onToggle={(event) => { const open = event.currentTarget.open; setIsOpen(open); if (open) setState(INITIAL_STATE); }} className="relative text-left"><summary className="filter-chip list-none [&::-webkit-details-marker]:hidden">Editar</summary><form ref={formRef} onSubmit={handleSubmitEdit} className="surface absolute right-0 z-20 mt-2 grid w-80 gap-3 p-4 shadow-xl"><div><h3 className="font-bold">Editar pallet</h3><p className="mt-1 text-xs text-stone-500">Actualizá su identificación, lote o ubicación.</p></div>{state.error && <p role="alert" className="feedback feedback-danger text-xs">{state.error}</p>}{state.success && <p role="status" className="feedback feedback-success text-xs">{state.success}</p>}<ProductField existingProducts={existingProducts} defaultSku={productSku} defaultName={pallet.productName} onSkuChange={setProductSku} /><LotField productSku={productSku} existingBatches={existingBatches} defaultValue={pallet.batchNumber} /><PalletField label="Código QR" name="qrCode" defaultValue={pallet.qrCode} /><PalletField label="Cantidad" name="quantity" type="number" defaultValue={pallet.quantity === null ? "" : String(pallet.quantity)} /><UnitOfMeasureField defaultValue={pallet.unitOfMeasure} /><PalletField label="Ubicación" name="currentLocation" defaultValue={pallet.currentLocation ?? "Depósito"} required={false} /><div className="flex justify-end gap-2"><button type="button" onClick={closeForm} className="button-secondary text-xs">Cancelar</button><button disabled={isPending} className="button-primary text-xs disabled:opacity-60">{isPending ? "Guardando..." : "Guardar cambios"}</button></div></form></details>{mayDelete ? <button type="button" disabled={isDeleting} onClick={handleDelete} className="min-h-11 text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-60">{isDeleting ? "Eliminando..." : "Eliminar"}</button> : <span title="Solo se pueden eliminar pallets en depósito" className="text-xs text-stone-400">No eliminable</span>}{deleteState?.error && <span role="alert" className="max-w-36 text-right text-xs text-red-600">{deleteState.error}</span>}</div>;
}

function PalletField({ label, name, defaultValue, type = "text", required = true, onChange }: { label: string; name: string; defaultValue: string; type?: string; required?: boolean; onChange?: (value: string) => void }) {
  const controlled = onChange ? { value: defaultValue, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) } : { defaultValue };
  return <label className="form-label">{label}<input required={required} name={name} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} {...controlled} className="form-control mt-1.5 font-normal" /></label>;
}
