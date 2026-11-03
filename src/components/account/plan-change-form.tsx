"use client";

import { useActionState, useState } from "react";
import { changeCompanyPlan } from "@/lib/plans/actions";
import { InlineAlert } from "@/components/ui/design-system";

export function PlanChangeForm({ targetCode, expectedCode, assignedAt, requestId, lower }: {
  targetCode: string; expectedCode: string; assignedAt: string; requestId: string; lower: boolean;
}) {
  const [state, action, pending] = useActionState(changeCompanyPlan, { error: null });
  const [confirmed, setConfirmed] = useState(false);
  return <form action={action} className="section-stack">
    <input type="hidden" name="targetCode" value={targetCode} />
    <input type="hidden" name="expectedCode" value={expectedCode} />
    <input type="hidden" name="assignedAt" value={assignedAt} />
    <input type="hidden" name="requestId" value={requestId} />
    <label className="flex items-start gap-3 text-sm text-stone-700">
      <input type="checkbox" name="confirmed" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0" />
      <span>Confirmo el cambio inmediato de la asignación interna. Revisé los avisos y acepto continuar aunque el consumo supere los límites, esté incompleto o no esté disponible. Este cambio no representa contratación ni cobro.</span>
    </label>
    {state.error ? <InlineAlert variant="danger">{state.error}</InlineAlert> : null}
    <button type="submit" className="button-primary w-full sm:w-auto" disabled={!confirmed || pending}>
      {pending ? "Actualizando plan…" : lower ? "Confirmar bajada" : "Confirmar subida"}
    </button>
  </form>;
}
