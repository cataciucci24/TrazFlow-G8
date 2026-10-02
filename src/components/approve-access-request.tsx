"use client";

import { useActionState, useState } from "react";
import { approveAccessRequest } from "@/lib/pending-access-requests/actions";

export function ApproveAccessRequest({ requestId, email, company, role }: {
  requestId: string; email: string | null; company: string; role: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(approveAccessRequest, { error: null });
  return (
    <div className="space-y-3">
      {!confirming ? <button type="button" className="button-primary" onClick={() => setConfirming(true)}>Aprobar</button> : (
        <form action={action} className="min-w-64 max-w-sm space-y-3 whitespace-normal">
          <input type="hidden" name="requestId" value={requestId} />
          <p className="text-sm">¿Aprobar el acceso de <strong className="break-all">{email ?? "este usuario"}</strong> a <strong>{company}</strong> como <strong>{role}</strong>?</p>
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={pending}>{pending ? "Aprobando…" : "Confirmar aprobación"}</button>
            <button type="button" className="button-secondary" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {state.error && <p role="alert" className="feedback feedback-danger max-w-sm whitespace-normal">{state.error}</p>}
    </div>
  );
}
