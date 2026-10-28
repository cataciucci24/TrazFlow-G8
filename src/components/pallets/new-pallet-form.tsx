"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useFeedback } from "@/components/ui/feedback";

import { ErpLotField } from "@/components/pallets/erp-lot-field";
import { LotField } from "@/components/pallets/lot-field";
import { ProductField, type ProductSelection } from "@/components/pallets/product-field";

import { useRef, useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { formatStockQuantity, type ErpStockRow } from "@/lib/erp-stock/types";
import { createPallet, type CreatePalletState } from "@/lib/pallets/actions";
import { quantityStep } from "@/lib/pallets/units";
import type { ExistingProduct, ProductBatch } from "@/lib/types";
import type { Warehouse } from "@/lib/warehouses/types";
import { WarehouseField } from "@/components/warehouses/warehouse-field";

const initialState: CreatePalletState = { error: null, success: null };
const NO_PRODUCT: ProductSelection = { sku: "", unitOfMeasure: null };

/**
 * Alta de pallet. Sin ERP: producto, lote existente y cantidad, como siempre (y el depósito, si la empresa tiene
 * más de uno). Con ERP (`erpLots`, TRZ-100): se elige un lote sincronizado del ERP con saldo en un depósito (el
 * pallet queda en ese depósito, TRZ-101) y se carga la cantidad real del pallet físico.
 */
export function NewPalletForm({
  existingBatches,
  existingProducts,
  erpLots,
  warehouses = [],
}: {
  existingBatches: ProductBatch[];
  existingProducts: ExistingProduct[];
  erpLots?: ErpStockRow[];
  warehouses?: Warehouse[];
}) {
  const notify = useFeedback();
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();
  const [product, setProduct] = useState(NO_PRODUCT);
  const [erpLot, setErpLot] = useState<ErpStockRow | null>(null);
  const erpMode = erpLots !== undefined;
  const unit = erpMode ? erpLot?.unitOfMeasure ?? null : product.unitOfMeasure;
  const [isOpen, setIsOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function closeForm() {
    setIsOpen(false);
    setIsDirty(false);
    formRef.current?.reset();
    setProduct(NO_PRODUCT);
    setErpLot(null);
    setState(initialState);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    startTransition(async () => {
      try {
        const nextState = await createPallet(state, new FormData(form));
        setState(nextState);
        if (nextState.success) {
          notify(nextState.success);
          formRef.current?.reset();
          setProduct(NO_PRODUCT);
          setErpLot(null);
          setIsOpen(false);
        }
      } catch {
        setState({ error: "No se pudo guardar el pallet. Intentá nuevamente.", success: null });
      }
    });
  }

  return (
    <>
      <button type="button" className="button-primary" onClick={() => { setState(initialState); setIsDirty(false); setIsOpen(true); }}>
        <span aria-hidden="true">+</span> {erpMode ? "Armar pallet" : "Nuevo pallet"}
      </button>
      <Modal open={isOpen} onClose={closeForm} title={erpMode ? "Armar pallet desde un lote del ERP" : "Registrar nuevo pallet"}
        description={erpMode
          ? "Elegí el lote y cargá la cantidad real del pallet. No puede superar el saldo disponible en el ERP."
          : "Quedará disponible en depósito para asociarlo a una orden. Cerrá o cancelá para descartar los datos sin guardar."}
        busy={isPending} dismissOnBackdrop={false} dismissOnEscape={!isDirty}>
        <form ref={formRef} onSubmit={handleSubmit} onChange={() => setIsDirty(true)} aria-busy={isPending}>
          <fieldset disabled={isPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
            {state.error && <InlineAlert variant="danger" className="sm:col-span-2">{state.error}</InlineAlert>}
            {state.success && <InlineAlert variant="success" className="sm:col-span-2">{state.success}</InlineAlert>}
            {erpLots !== undefined
              ? <ErpLotField lots={erpLots} warehouses={warehouses} onChange={setErpLot} />
              : <>
                  <ProductField existingProducts={existingProducts} onChange={setProduct} />
                  <LotField productSku={product.sku} existingBatches={existingBatches} />
                  <WarehouseField warehouses={warehouses} className="sm:col-span-2" />
                </>}
            <Field label={unit ? `Cantidad (${unit})` : "Cantidad"} name="quantity" type="number"
              placeholder={erpLot && erpLot.available > 0 ? `Hasta ${formatStockQuantity(erpLot.available, erpLot.unitOfMeasure)}` : "Mayor que 0"}
              step={quantityStep(unit)} />
            <p className="text-sm text-stone-500 sm:col-span-2">El código QR se genera automáticamente al registrar el pallet y no se puede modificar.</p>
            <div className="flex items-end justify-end gap-3 sm:col-span-2">
              <button type="button" onClick={closeForm} className="button-secondary">Cancelar</button>
              <button disabled={isPending} aria-busy={isPending} className="button-primary">{isPending ? "Registrando..." : erpMode ? "Armar pallet" : "Registrar pallet"}</button>
            </div>
          </fieldset>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, name, placeholder, type = "text", step, value, onChange }: { label: string; name: string; placeholder: string; type?: string; step?: string; value?: string; onChange?: (value: string) => void }) {
  const controlled = onChange ? { value: value ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) } : {};
  return <label className="form-label">{label}<input required name={name} type={type} min={type === "number" ? step : undefined} step={type === "number" ? step ?? "any" : undefined} placeholder={placeholder} {...controlled} className="form-control mt-2 font-normal" /></label>;
}
