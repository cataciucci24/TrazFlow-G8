"use client";

import { UnitOfMeasureField } from "@/components/pallets/unit-of-measure-field";
import { LotField } from "@/components/pallets/lot-field";
import { ProductField } from "@/components/pallets/product-field";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPallet, type CreatePalletState } from "@/lib/pallets/actions";
import type { ExistingProduct, ProductBatch } from "@/lib/types";

const initialState: CreatePalletState = { error: null, success: null };

export function NewPalletForm({
  existingBatches,
  existingProducts,
}: {
  existingBatches: ProductBatch[];
  existingProducts: ExistingProduct[];
}) {
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();
  const [productSku, setProductSku] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function closeForm() {
    detailsRef.current?.removeAttribute("open");
    setIsOpen(false);
    formRef.current?.reset();
    setProductSku("");
    setState(initialState);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(async () => {
      const nextState = await createPallet(state, new FormData(form));
      setState(nextState);
      if (nextState.success) {
        formRef.current?.reset();
        setProductSku("");
        detailsRef.current?.removeAttribute("open");
        setIsOpen(false);
      }
    });
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
  }, [isOpen]);

  return (
    <details
      ref={detailsRef}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setIsOpen(open);
        if (open) setState(initialState);
      }}
      className="group relative"
    >
      <summary className="button-primary list-none [&::-webkit-details-marker]:hidden"><span aria-hidden="true">+</span>&nbsp; Nuevo pallet</summary>
    <form ref={formRef} onSubmit={handleSubmit} className="surface absolute right-0 z-20 mt-3 grid w-[min(680px,calc(100vw-2rem))] gap-4 p-5 shadow-xl sm:grid-cols-2">
      <div className="sm:col-span-2"><h2 className="text-base font-bold">Registrar nuevo pallet</h2><p className="mt-1 text-sm text-stone-500">Quedará disponible en depósito para asociarlo a una orden.</p></div>
      {state.error && <p role="alert" className="sm:col-span-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="sm:col-span-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{state.success}</p>}
      <ProductField existingProducts={existingProducts} onSkuChange={setProductSku} />
      <LotField productSku={productSku} existingBatches={existingBatches} />
      <Field label="Código QR" name="qrCode" placeholder="PAL-0001" />
      <Field label="Cantidad" name="quantity" type="number" placeholder="Mayor que 0" />
      <UnitOfMeasureField />
      <div className="flex items-end justify-end gap-3 sm:col-span-2">
        <button type="button" onClick={closeForm} className="button-secondary">Cancelar</button>
        <button disabled={isPending} className="button-primary disabled:opacity-60">{isPending ? "Registrando..." : "Registrar pallet"}</button>
      </div>
    </form>
    </details>
  );
}

function Field({ label, name, placeholder, type = "text", value, onChange }: { label: string; name: string; placeholder: string; type?: string; value?: string; onChange?: (value: string) => void }) {
  const controlled = onChange ? { value: value ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) } : {};
  return <label className="form-label">{label}<input required name={name} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} placeholder={placeholder} {...controlled} className="form-control mt-2 font-normal" /></label>;
}
