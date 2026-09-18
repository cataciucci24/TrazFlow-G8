"use client";

import { UnitOfMeasureField } from "@/components/pallets/unit-of-measure-field";

import { useRef, useState, useTransition } from "react";
import { createPallet, type CreatePalletState } from "@/lib/pallets/actions";

const initialState: CreatePalletState = { error: null, success: null };

export function NewPalletForm() {
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(async () => {
      const nextState = await createPallet(state, new FormData(form));
      setState(nextState);
      if (nextState.success) {
        formRef.current?.reset();
        detailsRef.current?.removeAttribute("open");
      }
    });
  }

  return (
    <details ref={detailsRef} onToggle={(event) => { if (event.currentTarget.open) setState(initialState); }} className="group relative">
      <summary className="cursor-pointer list-none rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 [&::-webkit-details-marker]:hidden">＋ Nuevo pallet</summary>
    <form ref={formRef} onSubmit={handleSubmit} className="absolute right-0 z-20 mt-3 grid w-[min(680px,calc(100vw-2.5rem))] gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-xl sm:grid-cols-2">
      <div className="sm:col-span-2"><h2 className="text-base font-bold">Registrar nuevo pallet</h2><p className="mt-1 text-sm text-stone-500">Quedará disponible en depósito para asociarlo a una orden.</p></div>
      {state.error && <p role="alert" className="sm:col-span-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="sm:col-span-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{state.success}</p>}
      <Field label="Código QR" name="qrCode" placeholder="PAL-0001" />
      <Field label="Cantidad" name="quantity" type="number" placeholder="Mayor que 0" />
      <UnitOfMeasureField />
      <Field label="Producto" name="productName" placeholder="Nombre del producto" />
      <Field label="SKU" name="productSku" placeholder="SKU-001" />
      <Field label="Lote" name="batchNumber" placeholder="LOTE-0001" />
      <div className="flex items-end justify-end"><button disabled={isPending} className="w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60 sm:w-auto">{isPending ? "Registrando..." : "Registrar pallet"}</button></div>
    </form>
    </details>
  );
}

function Field({ label, name, placeholder, type = "text" }: { label: string; name: string; placeholder: string; type?: string }) {
  return <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">{label}<input required name={name} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" /></label>;
}
