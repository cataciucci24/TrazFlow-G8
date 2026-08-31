"use client";

import { useActionState } from "react";
import Link from "next/link";

import {
  createDispatchOrder,
  type CreateDispatchOrderState,
} from "@/lib/orders/actions";
import type { Distributor } from "@/lib/types";

type NewDispatchOrderFormProps = {
  distributors: Distributor[];
};

const INITIAL_STATE: CreateDispatchOrderState = {
  errors: {},
  values: { distributorId: "", estimatedDispatchDate: "", notes: "" },
};

export function NewDispatchOrderForm({
  distributors,
}: NewDispatchOrderFormProps) {
  const [state, formAction, isPending] = useActionState(
    createDispatchOrder,
    INITIAL_STATE,
  );

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
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
          className="block text-sm font-medium text-gray-700"
        >
          Distribuidor de destino
        </label>
        <select
          id="distributorId"
          name="distributorId"
          defaultValue={state.values.distributorId}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
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

      <div className="space-y-1">
        <label
          htmlFor="estimatedDispatchDate"
          className="block text-sm font-medium text-gray-700"
        >
          Fecha estimada de despacho
        </label>
        <input
          id="estimatedDispatchDate"
          name="estimatedDispatchDate"
          type="date"
          defaultValue={state.values.estimatedDispatchDate}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
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
          className="block text-sm font-medium text-gray-700"
        >
          Observaciones (opcional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={state.values.notes}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Link
          href="/dashboard"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creando..." : "Crear orden"}
        </button>
      </div>
    </form>
  );
}
