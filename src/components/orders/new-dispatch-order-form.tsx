"use client";

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
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.errors.form}
        </p>
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
          <p className="text-xs text-red-600">{state.errors.distributorId}</p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold uppercase tracking-wide text-stone-500">Pallets de la orden</legend>
        {pallets.length === 0 ? <p className="feedback feedback-warning">No hay pallets disponibles en depósito. Primero registrá uno desde Seguimiento.</p> : <div className="max-h-56 divide-y divide-stone-200 overflow-y-auto rounded-xl border border-stone-200 px-4">{pallets.map((pallet) => <label key={pallet.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-3 text-sm"><input name="palletIds" type="checkbox" value={pallet.id} checked={selectedPalletIds.includes(pallet.id)} onChange={(event) => setSelectedPalletIds((current) => event.target.checked ? [...current, pallet.id] : current.filter((id) => id !== pallet.id))} disabled={isPending} className="size-4 rounded border-stone-300 text-[var(--brand)] focus:ring-[var(--focus)]" /><span className="font-mono font-semibold">{pallet.qrCode}</span><span className="text-stone-500">{pallet.productName} · lote {pallet.batchNumber}</span></label>)}</div>}
        {state.errors.palletIds && <p className="text-xs text-red-600">{state.errors.palletIds}</p>}
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
          name="estimatedDispatchDate"
          type="date"
          value={values.estimatedDispatchDate}
          min={today}
          onChange={(event) => setValues((current) => ({ ...current, estimatedDispatchDate: event.target.value }))}
          disabled={isPending}
          className="form-control"
        />
        {state.errors.estimatedDispatchDate && (
          <p className="text-xs text-red-600">
            {state.errors.estimatedDispatchDate}
          </p>
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
          disabled={isPending}
          className="button-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creando..." : "Crear orden"}
        </button>
      </div>
    </form>
  );
}
