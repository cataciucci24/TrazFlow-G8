"use client";

import { actionErrorMessage } from "@/components/ui/feedback-messages";
import { InlineAlert } from "@/components/ui/design-system";

import { useActionState, useState } from "react";

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const associatePalletsForOrder = associatePallets.bind(null, orderId);
  const [state, formAction, isPending] = useActionState(
    associatePalletsForOrder,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <InlineAlert variant="danger">{actionErrorMessage(state.error)}</InlineAlert>
      )}

      {state.success && (
        <InlineAlert variant="success">{state.success}</InlineAlert>
      )}

      <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 px-4">
        {pallets.map((pallet) => (
          <li key={pallet.id} className="flex items-center gap-3 py-2 text-sm">
            <input
              id={`pallet-${pallet.id}`}
              name="palletIds"
              type="checkbox"
              value={pallet.id}
              checked={selectedIds.includes(pallet.id)}
              onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, pallet.id] : current.filter((id) => id !== pallet.id))}
              disabled={isPending}
              className="form-check"
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
          disabled={isPending} aria-busy={isPending}
          className="button-primary"
        >
          {isPending ? "Asociando..." : "Asociar pallets seleccionados"}
        </button>
      </div>
    </form>
  );
}
