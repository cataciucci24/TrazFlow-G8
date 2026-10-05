"use client";

import { useActionState, useState } from "react";
import { rejectAccessRequest } from "@/lib/operators/actions";

export function RejectAccessRequest({ requestId, email }: { requestId: string; email: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(rejectAccessRequest, { error: null });
  return (
    <div className="space-y-3">
      {!confirming ? <button type="button" className="button-secondary" onClick={() => setConfirming(true)}>Rechazar</button> : (
        <form action={action} className="min-w-64 max-w-sm space-y-3 whitespace-normal">
          <input type="hidden" name="requestId" value={requestId} />
          <p className="text-sm">¿Rechazar la solicitud de <strong className="break-all">{email ?? "este usuario"}</strong>? No podrá volver a solicitar acceso con esta cuenta.</p>
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={pending}>{pending ? "Rechazando…" : "Confirmar rechazo"}</button>
            <button type="button" className="button-secondary" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {state.error && <p role="alert" className="feedback feedback-danger max-w-sm whitespace-normal">{state.error}</p>}
    </div>
  );
}
