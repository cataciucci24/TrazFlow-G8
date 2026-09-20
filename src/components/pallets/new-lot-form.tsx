"use client";

import { useRef, useState, useTransition } from "react";

import { ProductField } from "@/components/pallets/product-field";
import { createLot, type CreateLotState } from "@/lib/pallets/actions";
import type { ExistingProduct } from "@/lib/types";

const INITIAL_STATE: CreateLotState = { error: null, success: null };
const FIELD_CLASS = "form-control mt-2 font-normal";

export function NewLotForm({ existingProducts }: { existingProducts: ExistingProduct[] }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function closeForm() {
    detailsRef.current?.removeAttribute("open");
    formRef.current?.reset();
    setState(INITIAL_STATE);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(async () => {
      const nextState = await createLot(state, new FormData(form));
      setState(nextState);
      if (nextState.success) closeForm();
    });
  }

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="button-primary list-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true">+</span>&nbsp; Agregar lote
      </summary>
      <form ref={formRef} onSubmit={handleSubmit} className="surface absolute right-0 z-20 mt-3 grid w-[min(680px,calc(100vw-2rem))] gap-4 p-5 shadow-xl sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="text-base font-bold">Registrar nuevo lote</h2>
          <p className="mt-1 text-sm text-stone-500">Podrás asociarle pallets desde la pestaña de seguimiento de pallets.</p>
        </div>
        {state.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 sm:col-span-2">{state.error}</p>}
        <ProductField existingProducts={existingProducts} />
        <Field label="Número de lote" name="batchNumber" placeholder="LOTE-001" />
        <Field label="Vencimiento (opcional)" name="expirationDate" type="date" />
        <div className="flex items-end justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={closeForm} className="button-secondary">Cancelar</button>
          <button disabled={isPending} className="button-primary disabled:opacity-60">
            {isPending ? "Registrando..." : "Registrar lote"}
          </button>
        </div>
      </form>
    </details>
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
