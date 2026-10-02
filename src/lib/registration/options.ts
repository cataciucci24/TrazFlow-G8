export type RegistrationCompany = { id: string; name: string };

export const requestedRoles = {
  warehouse_operator: "Operador de depósito",
  distributor_operator: "Operador de distribuidor",
} as const;

export function isRequestedRole(value: unknown): value is keyof typeof requestedRoles {
  return value === "warehouse_operator" || value === "distributor_operator";
}
