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

      <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 px-4">
        {pallets.map((pallet) => (
          <li key={pallet.id} className="flex items-center gap-3 py-2 text-sm">
            <input
              id={`pallet-${pallet.id}`}
              name="palletIds"
              type="checkbox"
              value={pallet.id}
              disabled={isPending}
              className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500"
            />
            <label htmlFor={`pallet-${pallet.id}`} className="flex-1">
              <span className="font-mono font-semibold text-slate-950">{pallet.qrCode}</span>{" "}
              <span className="text-stone-500">
                — {pallet.productName} ({pallet.productSku}), lote{" "}
                {pallet.batchNumber}
              </span>
            </label>
            <span className="text-xs text-stone-500">
              {PALLET_STATUS_LABELS[pallet.status]}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Asociando..." : "Asociar pallets seleccionados"}
        </button>
      </div>
    </form>
  );
}
