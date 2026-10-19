import { isUserRole, type UserProfile } from "../types.ts";

/** Fila de `public.users` tal como la devuelve Supabase. */
export type UserRow = {
  id: string;
  company_id: string;
  name: string;
  email: string;
  role: string;
  revoked_at: string | null;
};

/**
 * Perfil cuyo rol ya no existe en la app (ej: `distributor_operator`, reemplazado
 * por `driver_operator` en TRZ-91). No es "perfil inexistente": la fila existe,
 * así que no debe caer en el flujo de registro, pero tampoco puede entrar.
 */
export type UnknownRoleProfile = Omit<UserProfile, "role"> & {
  role: null;
  unknownRole: string;
};

export type StoredUserProfile = UserProfile | UnknownRoleProfile;

export function toUserProfile(row: UserRow): StoredUserProfile {
  const base = {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    email: row.email,
    revokedAt: row.revoked_at,
  };

  return isUserRole(row.role)
    ? { ...base, role: row.role }
    : { ...base, role: null, unknownRole: row.role };
}

export function hasUnknownRole(profile: StoredUserProfile): profile is UnknownRoleProfile {
  return profile.role === null;
}

/**
 * Si el perfil puede entrar al dashboard: acceso vigente y rol conocido.
 * Los que no pueden van a /access-status, que en esos casos no redirige de
 * vuelta al dashboard (sin loop).
 */
export function canAccessDashboard(profile: StoredUserProfile): profile is UserProfile {
  return !profile.revokedAt && !hasUnknownRole(profile);
}
