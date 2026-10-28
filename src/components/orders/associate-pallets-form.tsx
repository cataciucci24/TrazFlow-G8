"use client";

import { actionErrorMessage } from "@/components/ui/feedback-messages";
import { InlineAlert } from "@/components/ui/design-system";

import { useActionState, useState } from "react";

import {
  associatePallets,
  type AssociatePalletsState,
} from "@/lib/orders/actions";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import { formatPalletLocation } from "@/lib/locations/format";
import type { Pallet } from "@/lib/types";
import type { BatchPickingPolicy } from "@/lib/erp/types";
import { BATCH_PICKING_POLICY_LABELS, suggestedPalletIds } from "@/lib/pallets/picking";

type AssociatePalletsFormProps = {
  orderId: string;
  pallets: Pallet[];
  /** TRZ-65: regla de salida del ERP. Con valor, los pallets ya vienen ordenados y se marca el sugerido. */
  pickingPolicy?: BatchPickingPolicy | null;
};

const INITIAL_STATE: AssociatePalletsState = { error: null, success: null };

export function AssociatePalletsForm({
  orderId,
  pallets,
  pickingPolicy = null,
}: AssociatePalletsFormProps) {
  const suggested = pickingPolicy ? suggestedPalletIds(pallets) : new Set<string>();
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

      {pickingPolicy && (
        <p className="text-sm text-stone-600">
          Según tu ERP: {BATCH_PICKING_POLICY_LABELS[pickingPolicy]}. Te marcamos el pallet sugerido de cada producto; podés elegir otro.
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
              checked={selectedIds.includes(pallet.id)}
              onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, pallet.id] : current.filter((id) => id !== pallet.id))}
              disabled={isPending}
              className="form-check"
            />
            <label htmlFor={`pallet-${pallet.id}`} className="min-w-0 flex-1">
              <span className="font-mono font-semibold text-slate-950">{pallet.qrCode}</span>{" "}
              <span className="text-stone-500">
                — {pallet.productName} ({pallet.productSku}), lote{" "}
                {pallet.batchNumber}
                {pallet.batchExpirationDate ? ` · vence ${pallet.batchExpirationDate.slice(8, 10)}/${pallet.batchExpirationDate.slice(5, 7)}/${pallet.batchExpirationDate.slice(0, 4)}` : ""}
              </span>
              {suggested.has(pallet.id) && (
                <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Sugerido</span>
              )}
              <span className={`mt-0.5 block break-all font-mono text-xs ${pallet.location ? "font-semibold text-slate-700" : "text-stone-400"}`}>
                <span className="sr-only">Ubicación: </span>{formatPalletLocation(pallet.location)}
              </span>
            </label>
            <span className="shrink-0 text-xs text-stone-500">
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
