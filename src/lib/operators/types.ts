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
  /** Entregas `confirmed` asignadas al chofer. */
  inTransitOrders: number;
  /** Otros operadores activos vinculados al distribuidor actual. */
  otherActiveOperators: number;
};

export type OperatorActionState = { error: string | null };

/** Advierte antes de revocar a un chofer que todavía tiene entregas asignadas. */
export function hasActiveDeliveryAssignments(operator: CompanyOperator): boolean {
  return operator.role === "driver_operator" && operator.inTransitOrders > 0;
}
