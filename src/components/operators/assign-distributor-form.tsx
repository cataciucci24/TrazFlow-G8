"use client";

import { useActionState, useState } from "react";
import { assignOperatorDistributor } from "@/lib/operators/actions";
import { leavesDistributorUnattended, type CompanyOperator, type DistributorOption } from "@/lib/operators/types";

type Props = { operator: CompanyOperator; distributors: DistributorOption[] };

/** TRZ-19: vincular o reasignar el distribuidor de un operador de distribuidor. */
export function AssignDistributorForm({ operator, distributors }: Props) {
  const [distributorId, setDistributorId] = useState(operator.distributorId ?? "");
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(assignOperatorDistributor, { error: null });

  const changed = distributorId !== "" && distributorId !== operator.distributorId;
  // Solo se avisa al sacar al operador de un distribuidor que queda desatendido.
  const needsWarning = changed && leavesDistributorUnattended(operator);

  return (
    <form action={action} className="min-w-72 max-w-sm space-y-3 whitespace-normal">
      <input type="hidden" name="userId" value={operator.userId} />
      <input type="hidden" name="distributorId" value={distributorId} />
      <div className="flex items-center gap-2">
        <label htmlFor={`distributor-${operator.userId}`} className="sr-only">Distribuidor de {operator.name}</label>
        <select id={`distributor-${operator.userId}`} className="form-control form-control-sm" value={distributorId} disabled={pending || confirming}
          onChange={(event) => setDistributorId(event.target.value)}>
          <option value="">Elegí un distribuidor</option>
          {distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name}</option>)}
        </select>
        {!confirming && (needsWarning
          ? <button type="button" className="button-primary button-sm shrink-0 whitespace-nowrap" disabled={!changed} onClick={() => setConfirming(true)}>Guardar</button>
          : <button className="button-primary button-sm shrink-0 whitespace-nowrap" disabled={!changed || pending}>{pending ? "Guardando…" : "Guardar"}</button>)}
      </div>
      {confirming && (
        <div className="feedback feedback-warning space-y-3">
          <p className="text-sm">
            <strong>{operator.distributorName}</strong> tiene {operator.inTransitOrders} {operator.inTransitOrders === 1 ? "orden" : "órdenes"} en
            tránsito y quedará sin operadores para recibirlas. ¿Reasignar igual?
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="button-primary button-sm" disabled={pending}>{pending ? "Guardando…" : "Reasignar igual"}</button>
            <button type="button" className="button-secondary button-sm" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {state.error && <p role="alert" className="feedback feedback-danger">{state.error}</p>}
    </form>
  );
}
