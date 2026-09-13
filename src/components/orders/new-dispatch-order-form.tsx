"use client";

import { useActionState } from "react";
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
          defaultValue={state.values.distributorId}
          disabled={isPending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
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
        {pallets.length === 0 ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">No hay pallets disponibles en depósito. Primero registrá uno desde Seguimiento.</p> : <div className="max-h-56 divide-y divide-stone-200 overflow-y-auto rounded-xl border border-stone-200 px-4">{pallets.map((pallet) => <label key={pallet.id} className="flex cursor-pointer items-center gap-3 py-3 text-sm"><input name="palletIds" type="checkbox" value={pallet.id} disabled={isPending} className="size-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500" /><span className="font-mono font-semibold">{pallet.qrCode}</span><span className="text-stone-500">{pallet.productName} · lote {pallet.batchNumber}</span></label>)}</div>}
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
          defaultValue={state.values.estimatedDispatchDate}
          disabled={isPending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
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
          defaultValue={state.values.notes}
          disabled={isPending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Link
          href="/dashboard/orders"
          className="rounded-xl border border-stone-200 px-5 py-3 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creando..." : "Crear orden"}
        </button>
      </div>
    </form>
  );
}
