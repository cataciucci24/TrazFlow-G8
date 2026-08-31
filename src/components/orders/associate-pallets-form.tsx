"use client";

import { useActionState } from "react";

import {
  associatePallets,
  type AssociatePalletsState,
} from "@/lib/orders/actions";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { Pallet } from "@/lib/types";

type AssociatePalletsFormProps = {
  orderId: string;
  pallets: Pallet[];
};

const INITIAL_STATE: AssociatePalletsState = { error: null, success: null };

export function AssociatePalletsForm({
  orderId,
  pallets,
}: AssociatePalletsFormProps) {
  const associatePalletsForOrder = associatePallets.bind(null, orderId);
  const [state, formAction, isPending] = useActionState(
    associatePalletsForOrder,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      {state.success && (
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          {state.success}
        </p>
      )}

      <ul className="divide-y divide-gray-100">
        {pallets.map((pallet) => (
          <li key={pallet.id} className="flex items-center gap-3 py-2 text-sm">
            <input
              id={`pallet-${pallet.id}`}
              name="palletIds"
              type="checkbox"
              value={pallet.id}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <label htmlFor={`pallet-${pallet.id}`} className="flex-1">
              <span className="font-medium text-gray-900">{pallet.qrCode}</span>{" "}
              <span className="text-gray-500">
                — {pallet.productName} ({pallet.productSku}), lote{" "}
                {pallet.batchNumber}
              </span>
            </label>
            <span className="text-xs text-gray-500">
              {PALLET_STATUS_LABELS[pallet.status]}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Asociando..." : "Asociar pallets seleccionados"}
        </button>
      </div>
    </form>
  );
}
