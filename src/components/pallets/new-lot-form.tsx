"use client";

import { useRef, useState, useTransition } from "react";

import { ProductField } from "@/components/pallets/product-field";
import { createLot, type CreateLotState } from "@/lib/pallets/actions";
import type { ExistingProduct } from "@/lib/types";

const INITIAL_STATE: CreateLotState = { error: null, success: null };
const FIELD_CLASS = "mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100";

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
      <summary className="cursor-pointer list-none rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 [&::-webkit-details-marker]:hidden">
        ＋ Agregar lote
      </summary>
      <form ref={formRef} onSubmit={handleSubmit} className="absolute right-0 z-20 mt-3 grid w-[min(680px,calc(100vw-2.5rem))] gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-xl sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="text-base font-bold">Registrar nuevo lote</h2>
          <p className="mt-1 text-sm text-stone-500">Podrás asociarle pallets desde la pestaña de seguimiento de pallets.</p>
        </div>
        {state.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 sm:col-span-2">{state.error}</p>}
        <ProductField existingProducts={existingProducts} />
        <Field label="Número de lote" name="batchNumber" placeholder="LOTE-001" />
        <Field label="Vencimiento (opcional)" name="expirationDate" type="date" />
        <div className="flex items-end justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={closeForm} className="rounded-xl px-5 py-3 text-sm font-bold text-stone-600 hover:text-stone-800">Cancelar</button>
          <button disabled={isPending} className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">
            {isPending ? "Registrando..." : "Registrar lote"}
          </button>
        </div>
      </form>
    </details>
  );
}

function Field({ label, name, placeholder, type = "text" }: { label: string; name: string; placeholder?: string; type?: string }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
      {label}
      <input required={type !== "date"} name={name} type={type} placeholder={placeholder} className={FIELD_CLASS} />
    </label>
  );
}
