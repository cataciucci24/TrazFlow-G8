"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useFeedback } from "@/components/ui/feedback";

import { LotField } from "@/components/pallets/lot-field";
import { ProductField, type ProductSelection } from "@/components/pallets/product-field";

import { useRef, useState, useTransition } from "react";

import { PalletQrDialog } from "@/components/pallets/pallet-qr-button";
import { ConfirmationDialog, Modal } from "@/components/ui/modal";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import { deletePallet, updatePallet, type UpdatePalletState } from "@/lib/pallets/actions";
import { quantityStep } from "@/lib/pallets/units";
import type { ExistingProduct, PalletWithHistory, ProductBatch } from "@/lib/types";

const INITIAL_STATE: UpdatePalletState = { error: null, success: null };

/**
 * Menú "⋯" de la fila de un pallet con todas sus acciones: ver trazabilidad, ver QR, imprimir la etiqueta, editar
 * (solo si se puede; si no, no aparece) y eliminar (deshabilitado con el motivo cuando no se puede). Los diálogos
 * de QR, edición y eliminación se abren desde el menú.
 */
export function PalletRowActions({
  pallet,
  existingBatches,
  existingProducts,
  erpManaged = false,
}: {
  pallet: PalletWithHistory;
  existingBatches: ProductBatch[];
  existingProducts: ExistingProduct[];
  /**
   * Con ERP (TRZ-100): solo se edita la cantidad, y solo de los pallets armados en TrazFlow contra un lote del ERP.
   * Los heredados de saldos del ERP y los de lotes manuales no se editan.
   */
  erpManaged?: boolean;
}) {
  // Asociado a una orden en borrador (TRZ-100): solo la cantidad, también sin ERP.
  const isAssigned = pallet.status === "assigned";
  const quantityOnly = erpManaged || isAssigned;
  const allowEdit = pallet.origin?.sourceSystem !== "erp" && (!erpManaged || pallet.lotSourceSystem === "erp");
  const notify = useFeedback();
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const palletProduct: ProductSelection = { sku: pallet.productSku, unitOfMeasure: pallet.unitOfMeasure };
  const [product, setProduct] = useState(palletProduct);
  const [deleteState, setDeleteState] = useState<{ error: string | null; success: string | null } | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Un pallet con eventos de trazabilidad no se elimina: la base lo impide para
  // conservar el historial.
  // Un pallet heredado de un saldo del ERP tampoco: la base lo impide para conservar su trazabilidad.
  const isImported = pallet.origin?.sourceSystem === "erp";
  const mayDelete = pallet.status === "in_warehouse" && !pallet.hasHistory && !isImported;
  const notDeletableReason = isImported
    ? "heredado de un saldo del ERP"
    : pallet.hasHistory
      ? "tiene historial de trazabilidad"
      : "solo se eliminan pallets en depósito";
  // Fuera del depósito el pallet ya forma parte de un despacho: sus datos no se editan.
  // Fuera del depósito, solo mientras está en una orden sin despachar (assigned).
  const mayEdit = allowEdit && (pallet.status === "in_warehouse" || isAssigned);

  const actions: RowAction[] = [
    { label: "Ver trazabilidad", href: `/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}` },
    { label: "Ver QR", onSelect: () => setQrOpen(true) },
    { label: "Imprimir etiqueta", href: `/dashboard/pallets/print?ids=${pallet.id}` },
    ...(mayEdit ? [{ label: "Editar", onSelect: openEdit }] : []),
    mayDelete
      ? { label: "Eliminar", danger: true, onSelect: () => { setDeleteState(null); setDeleteOpen(true); } }
      : { label: "Eliminar", disabledReason: notDeletableReason },
  ];

  function openEdit() {
    setState(INITIAL_STATE);
    setProduct(palletProduct);
    setIsDirty(false);
    setIsOpen(true);
  }

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
    setProduct(palletProduct);
    setState(INITIAL_STATE);
  }

  return (
    <div className="inline-flex flex-col items-end gap-2">
      <RowActionsMenu label={`Acciones del pallet ${pallet.qrCode}`} actions={actions} />
      <PalletQrDialog pallet={pallet} open={qrOpen} onClose={() => setQrOpen(false)} />
      <Modal open={mayEdit && isOpen} onClose={closeForm} title={quantityOnly ? "Editar cantidad del pallet" : "Editar pallet"}
        description={isAssigned
          ? "Está asociado a una orden sin despachar: solo se cambia la cantidad (sin superar el saldo del lote en el ERP). Si depósito ya lo validó, lo tendrá que volver a escanear. Después reimprimí la etiqueta."
          : quantityOnly
          ? "Con el ERP activo solo se cambia la cantidad, sin superar el saldo disponible del lote."
          : "Actualizá su producto, lote o ubicación. Cerrá o cancelá para descartar los datos sin guardar."}
        busy={isPending} dismissOnBackdrop={false} dismissOnEscape={!isDirty}>
        <form ref={formRef} onSubmit={handleSubmitEdit} onChange={() => setIsDirty(true)} aria-busy={isPending}>
          <fieldset disabled={isPending} className="grid min-w-0 gap-4">
            {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
            {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
            {quantityOnly
              ? <p className="text-sm text-stone-600">{pallet.productName} ({pallet.productSku}) · Lote <span className="font-mono">{pallet.batchNumber}</span></p>
              : <>
                  <ProductField existingProducts={existingProducts} defaultSku={product.sku} defaultName={pallet.productName} onChange={setProduct} />
                  <LotField productSku={product.sku} existingBatches={existingBatches} defaultValue={pallet.batchNumber} />
                </>}
            <p className="break-all text-xs text-stone-500">Código QR (no editable): <span className="font-mono">{pallet.qrCode}</span></p>
            <PalletField label={product.unitOfMeasure ? `Cantidad (${product.unitOfMeasure})` : "Cantidad"} name="quantity" type="number" step={quantityStep(product.unitOfMeasure)} defaultValue={pallet.quantity === null ? "" : String(pallet.quantity)} />
            <p className="text-sm text-stone-500">Ubicación: {pallet.currentLocation ?? "Sin asignar"}. Los cambios se registran desde Ubicaciones.</p>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={closeForm} className="button-secondary">Cancelar</button>
              <button disabled={isPending} aria-busy={isPending} className="button-primary">{isPending ? "Guardando..." : "Guardar cambios"}</button>
            </div>
          </fieldset>
        </form>
      </Modal>
      <ConfirmationDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete}
        title="Eliminar pallet" description={<>Vas a eliminar el pallet <strong className="break-all font-mono">{pallet.qrCode}</strong>. Esta acción no se puede deshacer.</>}
        confirmLabel="Eliminar pallet" danger busy={isDeleting} blocked={!mayDelete} error={deleteState?.error} />
      {deleteState?.error && !deleteOpen && <InlineAlert variant="danger" className="max-w-64">{deleteState.error}</InlineAlert>}
    </div>
  );
}

function PalletField({ label, name, defaultValue, type = "text", step, required = true, onChange }: { label: string; name: string; defaultValue: string; type?: string; step?: string; required?: boolean; onChange?: (value: string) => void }) {
  const controlled = onChange ? { value: defaultValue, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) } : { defaultValue };
  return <label className="form-label">{label}<input required={required} name={name} type={type} min={type === "number" ? step : undefined} step={type === "number" ? step ?? "any" : undefined} {...controlled} className="form-control mt-1.5 font-normal" /></label>;
}
