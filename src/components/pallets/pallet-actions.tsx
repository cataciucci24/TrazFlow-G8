"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useFeedback } from "@/components/ui/feedback";

import { UnitOfMeasureField } from "@/components/pallets/unit-of-measure-field";
import { LotField } from "@/components/pallets/lot-field";
import { ProductField } from "@/components/pallets/product-field";

import { useRef, useState, useTransition } from "react";

import { ConfirmationDialog, Modal } from "@/components/ui/modal";
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
  const notify = useFeedback();
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [productSku, setProductSku] = useState(pallet.productSku);
  const [deleteState, setDeleteState] = useState<{ error: string | null; success: string | null } | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const mayDelete = pallet.status === "in_warehouse";

  function handleDelete() {
    if (isDeleting || !mayDelete) return;
    startDeleting(async () => {
      try {
        const nextState = await deletePallet(pallet.id);
        setDeleteState(nextState);
        if (nextState.success) { notify(nextState.success); setDeleteOpen(false); }
      } catch {
        setDeleteState({ error: "No se pudo eliminar el pallet. Intentá nuevamente.", success: null });
      }
    });
  }

  function handleSubmitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    startTransition(async () => {
      try {
        const nextState = await updatePallet(pallet.id, state, new FormData(form));
        setState(nextState);
        if (nextState.success) { notify(nextState.success); setIsOpen(false); }
      } catch {
        setState({ error: "No se pudo guardar el pallet. Intentá nuevamente.", success: null });
      }
    });
  }

  function closeForm() {
    setIsOpen(false);
    setIsDirty(false);
    formRef.current?.reset();
    setProductSku(pallet.productSku);
    setState(INITIAL_STATE);
  }

  return (
    <div className="inline-flex flex-col items-end gap-2">
      <button type="button" onClick={() => { setState(INITIAL_STATE); setProductSku(pallet.productSku); setIsDirty(false); setIsOpen(true); }} className="button-secondary button-sm">Editar</button>
      <Modal open={isOpen} onClose={closeForm} title="Editar pallet"
        description="Actualizá su producto, lote o ubicación. Cerrá o cancelá para descartar los datos sin guardar."
        busy={isPending} dismissOnBackdrop={false} dismissOnEscape={!isDirty}>
        <form ref={formRef} onSubmit={handleSubmitEdit} onChange={() => setIsDirty(true)} aria-busy={isPending}>
          <fieldset disabled={isPending} className="grid min-w-0 gap-4">
            {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
            {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
            <ProductField existingProducts={existingProducts} defaultSku={productSku} defaultName={pallet.productName} onSkuChange={setProductSku} />
            <LotField productSku={productSku} existingBatches={existingBatches} defaultValue={pallet.batchNumber} />
            <p className="break-all text-xs text-stone-500">Código QR (no editable): <span className="font-mono">{pallet.qrCode}</span></p>
            <PalletField label="Cantidad" name="quantity" type="number" defaultValue={pallet.quantity === null ? "" : String(pallet.quantity)} />
            <UnitOfMeasureField defaultValue={pallet.unitOfMeasure} />
            <PalletField label="Ubicación" name="currentLocation" defaultValue={pallet.currentLocation ?? "Depósito"} required={false} />
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={closeForm} className="button-secondary">Cancelar</button>
              <button disabled={isPending} aria-busy={isPending} className="button-primary">{isPending ? "Guardando..." : "Guardar cambios"}</button>
            </div>
          </fieldset>
        </form>
      </Modal>
      {mayDelete ? <button type="button" disabled={isDeleting} aria-busy={isDeleting} onClick={() => { setDeleteState(null); setDeleteOpen(true); }} className="button-danger button-sm">Eliminar</button> : <span title="Solo se pueden eliminar pallets en depósito" className="text-xs text-stone-400">No eliminable</span>}
      <ConfirmationDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete}
        title="Eliminar pallet" description={<>Vas a eliminar el pallet <strong className="break-all font-mono">{pallet.qrCode}</strong>. Esta acción no se puede deshacer.</>}
        confirmLabel="Eliminar pallet" danger busy={isDeleting} blocked={!mayDelete} error={deleteState?.error} />
      {deleteState?.error && !deleteOpen && <InlineAlert variant="danger" className="max-w-64">{deleteState.error}</InlineAlert>}
    </div>
  );
}

function PalletField({ label, name, defaultValue, type = "text", required = true, onChange }: { label: string; name: string; defaultValue: string; type?: string; required?: boolean; onChange?: (value: string) => void }) {
  const controlled = onChange ? { value: defaultValue, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) } : { defaultValue };
  return <label className="form-label">{label}<input required={required} name={name} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} {...controlled} className="form-control mt-1.5 font-normal" /></label>;
}
