import type { RequestedRole } from "@/lib/access-requests/types";

/** Operador de la empresa, tal como lo devuelve `get_company_operators` (TRZ-19 / TRZ-38). */
export type CompanyOperator = {
  userId: string;
  name: string;
  email: string;
  role: RequestedRole;
  revokedAt: string | null;
  distributorId: string | null;
  distributorName: string | null;
  /** Órdenes `confirmed` (en tránsito) del distribuidor actual. */
  inTransitOrders: number;
  /** Otros operadores activos vinculados al distribuidor actual. */
  otherActiveOperators: number;
};

export type DistributorOption = { id: string; name: string };

export type OperatorActionState = { error: string | null };

/**
 * Opción B del plan: reasignar o revocar se permite, pero se avisa si el
 * distribuidor actual queda sin nadie que reciba sus órdenes en tránsito.
 */
export function leavesDistributorUnattended(operator: CompanyOperator): boolean {
  return operator.distributorId !== null && operator.otherActiveOperators === 0 && operator.inTransitOrders > 0;
}
