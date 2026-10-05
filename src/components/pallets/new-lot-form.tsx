"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useFeedback } from "@/components/ui/feedback";

import { useRef, useState, useTransition } from "react";

import { Modal } from "@/components/ui/modal";
import { ProductField } from "@/components/pallets/product-field";
import { createLot, type CreateLotState } from "@/lib/pallets/actions";
import type { ExistingProduct } from "@/lib/types";

const INITIAL_STATE: CreateLotState = { error: null, success: null };
const FIELD_CLASS = "form-control mt-2 font-normal";

export function NewLotForm({ existingProducts }: { existingProducts: ExistingProduct[] }) {
  const notify = useFeedback();
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  function closeForm() {
    setIsOpen(false);
    setIsDirty(false);
    formRef.current?.reset();
    setState(INITIAL_STATE);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    startTransition(async () => {
      try {
        const nextState = await createLot(state, new FormData(form));
        setState(nextState);
        if (nextState.success) { notify(nextState.success); closeForm(); }
      } catch {
        setState({ error: "No se pudo guardar el lote. Intentá nuevamente.", success: null });
      }
    });
  }

  return (
    <>
      <button type="button" className="button-primary" onClick={() => { setState(INITIAL_STATE); setIsDirty(false); setIsOpen(true); }}>
        <span aria-hidden="true">+</span> Agregar lote
      </button>
      <Modal open={isOpen} onClose={closeForm} title="Registrar nuevo lote"
        description="Podrás asociarle pallets desde la pestaña de seguimiento de pallets. Cerrá o cancelá para descartar los datos sin guardar."
        busy={isPending} dismissOnBackdrop={false} dismissOnEscape={!isDirty}>
        <form ref={formRef} onSubmit={handleSubmit} onChange={() => setIsDirty(true)} aria-busy={isPending}>
          <fieldset disabled={isPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
            {state.error && <InlineAlert variant="danger" className="sm:col-span-2">{state.error}</InlineAlert>}
            <ProductField existingProducts={existingProducts} />
            <Field label="Número de lote" name="batchNumber" placeholder="LOTE-001" />
            <Field label="Vencimiento (opcional)" name="expirationDate" type="date" />
            <div className="flex items-end justify-end gap-3 sm:col-span-2">
              <button type="button" onClick={closeForm} className="button-secondary">Cancelar</button>
              <button disabled={isPending} aria-busy={isPending} className="button-primary">
                {isPending ? "Registrando..." : "Registrar lote"}
              </button>
            </div>
          </fieldset>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, name, placeholder, type = "text" }: { label: string; name: string; placeholder?: string; type?: string }) {
  return (
    <label className="form-label">
      {label}
      <input required={type !== "date"} name={name} type={type} placeholder={placeholder} className={FIELD_CLASS} />
    </label>
  );
}
