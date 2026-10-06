"use client";

import { useActionState } from "react";

import { InlineAlert } from "@/components/ui/design-system";
import { saveExpirationThresholds, type SaveExpirationThresholdsState } from "@/lib/expiration/actions";
import { MAX_EXPIRATION_DAYS } from "@/lib/expiration/thresholds";
import type { ExpirationThresholds } from "@/lib/types";

const INITIAL_STATE: SaveExpirationThresholdsState = { error: null, success: null };

/** Días de cada nivel de alerta de vencimiento. Valen para depósito y distribuidoras. */
export function ExpirationThresholdsForm({ thresholds }: { thresholds: ExpirationThresholds }) {
  const [state, formAction, isPending] = useActionState(saveExpirationThresholds, INITIAL_STATE);
  const fields = [
    { name: "criticalDays", label: "Crítico hasta", value: thresholds.criticalDays },
    { name: "cautionDays", label: "Precaución hasta", value: thresholds.cautionDays },
    { name: "upcomingDays", label: "Próximo hasta", value: thresholds.upcomingDays },
  ];

  return (
    <details className="surface group">
      <summary className="flex min-h-11 list-none items-center justify-between gap-3 rounded-[var(--radius)] px-5 py-3 text-sm font-semibold text-stone-800 hover:text-stone-950 [&::-webkit-details-marker]:hidden">
        <span>Criterios de alerta</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 flex-none text-stone-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 7.5 5 5 5-5" /></svg>
      </summary>
      <form action={formAction} className="space-y-4 border-t border-stone-200 px-5 py-4">
        <p className="text-sm text-stone-600">
          Configurá cuántos días antes del vencimiento se genera la alerta. Aplica a lotes de un producto en depósitos o los informados por distribuidoras.
        </p>
        {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
        {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
        <div className="grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
          {fields.map((field) => (
            <label key={field.name} className="space-y-1.5">
              <span className="form-label">{field.label}</span>
              <span className="flex items-center gap-2">
                <input name={field.name} type="number" min="1" max={MAX_EXPIRATION_DAYS} step="1" required defaultValue={field.value} disabled={isPending} className="form-control" />
                <span className="text-sm text-stone-500">días</span>
              </span>
            </label>
          ))}
          <button type="submit" disabled={isPending} aria-busy={isPending} className="button-primary">
            {isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </details>
  );
}
