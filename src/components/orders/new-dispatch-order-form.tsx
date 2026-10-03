"use client";

import { actionErrorMessage } from "@/components/ui/feedback-messages";
import { InlineAlert } from "@/components/ui/design-system";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  createDispatchOrder,
  type CreateDispatchOrderState,
} from "@/lib/orders/actions";
import type { Distributor } from "@/lib/types";
import type { Pallet } from "@/lib/types";

type NewDispatchOrderFormProps = {
  distributors: Distributor[];
  pallets: Pallet[];
};

const INITIAL_STATE: CreateDispatchOrderState = {
  errors: {},
  values: { distributorId: "", estimatedDispatchDate: "", notes: "" },
};

export function NewDispatchOrderForm({
  distributors,
  pallets,
}: NewDispatchOrderFormProps) {
  const [state, formAction, isPending] = useActionState(
    createDispatchOrder,
    INITIAL_STATE,
  );
  const [values, setValues] = useState(INITIAL_STATE.values);
  const [selectedPalletIds, setSelectedPalletIds] = useState<string[]>([]);
  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());

  return (
    <form
      action={formAction}
      className="space-y-5"
    >
      {state.errors.form && (
        <InlineAlert variant="danger">{actionErrorMessage(state.errors.form)}</InlineAlert>
      )}

      <div className="space-y-1">
        <label
          htmlFor="distributorId"
          className="block text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Distribuidor de destino
        </label>
        <select
          id="distributorId"
          aria-invalid={Boolean(state.errors.distributorId)}
          aria-describedby={state.errors.distributorId ? "distributorId-error" : undefined}
          name="distributorId"
          value={values.distributorId}
          onChange={(event) => setValues((current) => ({ ...current, distributorId: event.target.value }))}
          disabled={isPending}
          className="form-control"
        >
          <option value="">Seleccionar distribuidor</option>
          {distributors.map((distributor) => (
            <option key={distributor.id} value={distributor.id}>
              {distributor.name}
            </option>
          ))}
        </select>
        {state.errors.distributorId && (
          <InlineAlert id="distributorId-error" variant="danger">{state.errors.distributorId}</InlineAlert>
        )}
      </div>

      <fieldset className="space-y-2" aria-describedby={state.errors.palletIds ? "palletIds-error" : undefined}>
        <legend className="text-sm font-semibold uppercase tracking-wide text-stone-500">Pallets de la orden</legend>
        {pallets.length === 0 ? <InlineAlert variant="warning">No hay pallets disponibles en depósito. Primero registrá uno desde Seguimiento.</InlineAlert> : <div className="max-h-56 divide-y divide-stone-200 overflow-y-auto rounded-xl border border-stone-200 px-4">{pallets.map((pallet) => <label key={pallet.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-3 text-sm"><input name="palletIds" type="checkbox" value={pallet.id} checked={selectedPalletIds.includes(pallet.id)} onChange={(event) => setSelectedPalletIds((current) => event.target.checked ? [...current, pallet.id] : current.filter((id) => id !== pallet.id))} disabled={isPending} className="form-check" /><span className="font-mono font-semibold">{pallet.qrCode}</span><span className="text-stone-500">{pallet.productName} · lote {pallet.batchNumber}</span></label>)}</div>}
        {state.errors.palletIds && <InlineAlert id="palletIds-error" variant="danger">{state.errors.palletIds}</InlineAlert>}
      </fieldset>

      <div className="space-y-1">
        <label
          htmlFor="estimatedDispatchDate"
          className="block text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Fecha estimada de despacho
        </label>
        <input
          id="estimatedDispatchDate"
          aria-invalid={Boolean(state.errors.estimatedDispatchDate)}
          aria-describedby={state.errors.estimatedDispatchDate ? "estimatedDispatchDate-error" : undefined}
          name="estimatedDispatchDate"
          type="date"
          value={values.estimatedDispatchDate}
          min={today}
          onChange={(event) => setValues((current) => ({ ...current, estimatedDispatchDate: event.target.value }))}
          disabled={isPending}
          className="form-control"
        />
        {state.errors.estimatedDispatchDate && (
          <InlineAlert id="estimatedDispatchDate-error" variant="danger">{state.errors.estimatedDispatchDate}</InlineAlert>
        )}
      </div>

      <div className="space-y-1">
        <label
          htmlFor="notes"
          className="block text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Observaciones (opcional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          value={values.notes}
          onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
          disabled={isPending}
          className="form-control"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Link
          href="/dashboard/orders"
          className="button-secondary"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={isPending} aria-busy={isPending}
          className="button-primary"
        >
          {isPending ? "Creando..." : "Crear orden"}
        </button>
      </div>
    </form>
  );
}
