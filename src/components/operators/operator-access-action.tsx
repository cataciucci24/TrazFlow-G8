"use client";

import { useActionState, useState } from "react";
import { restoreOperatorAccess, revokeOperatorAccess } from "@/lib/operators/actions";
import { leavesDistributorUnattended, type CompanyOperator } from "@/lib/operators/types";

/** TRZ-38: revocar el acceso de un operador activo o restaurarlo si estaba revocado. */
export function OperatorAccessAction({ operator }: { operator: CompanyOperator }) {
  const revoked = operator.revokedAt !== null;
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(revoked ? restoreOperatorAccess : revokeOperatorAccess, { error: null });

  return (
    <div className="space-y-3">
      {!confirming ? (
        <button type="button" className="button-secondary" onClick={() => setConfirming(true)}>
          {revoked ? "Restaurar acceso" : "Revocar acceso"}
        </button>
      ) : (
        <form action={action} className="min-w-64 max-w-sm space-y-3 whitespace-normal">
          <input type="hidden" name="userId" value={operator.userId} />
          <p className="text-sm">
            {revoked
              ? <>¿Restaurar el acceso de <strong>{operator.name}</strong>?{operator.role === "distributor_operator" && " Después tendrás que vincularlo a un distribuidor."}</>
              : <>¿Revocar el acceso de <strong>{operator.name}</strong>? Dejará de ver y operar en TrazFlow. Su historial se conserva.</>}
          </p>
          {!revoked && leavesDistributorUnattended(operator) && (
            <p className="feedback feedback-warning text-sm">
              <strong>{operator.distributorName}</strong> tiene {operator.inTransitOrders} {operator.inTransitOrders === 1 ? "orden" : "órdenes"} en
              tránsito y quedará sin operadores para recibirlas.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={pending}>
              {pending ? "Guardando…" : revoked ? "Confirmar restauración" : "Confirmar revocación"}
            </button>
            <button type="button" className="button-secondary" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {state.error && <p role="alert" className="feedback feedback-danger max-w-sm whitespace-normal">{state.error}</p>}
    </div>
  );
}
