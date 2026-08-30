/** Roles de la app, espejo del enum `user_role` de Postgres. */
export type UserRole =
  | "logistics_manager"
  | "warehouse_operator"
  | "distributor_operator";

/** Perfil del usuario logueado (fila de la tabla `users`). */
export type UserProfile = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: UserRole;
};
