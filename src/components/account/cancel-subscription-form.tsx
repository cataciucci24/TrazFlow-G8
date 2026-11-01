"use client";

import { useActionState, useState } from "react";
import { cancelSubscription } from "@/lib/plans/subscription-actions";
import { InlineAlert } from "@/components/ui/design-system";

export function CancelSubscriptionForm({ accessUntilLabel }: { accessUntilLabel: string }) {
  const [state, action, pending] = useActionState(cancelSubscription, { error: null });
  const [confirmed, setConfirmed] = useState(false);
  return <form action={action} className="section-stack">
    <label className="flex items-start gap-3 text-sm text-stone-700">
      <input type="checkbox" name="confirmed" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0" />
      <span>Entiendo que no se cobrará el próximo período, que mi empresa podrá usar TrazFlow hasta el {accessUntilLabel} inclusive y que después se cortará el acceso de todos sus usuarios.</span>
    </label>
    {state.error ? <InlineAlert variant="danger">{state.error}</InlineAlert> : null}
    <button type="submit" className="button-secondary w-full sm:w-auto" disabled={!confirmed || pending}>
      {pending ? "Cancelando…" : "Cancelar suscripción"}
    </button>
  </form>;
}
