import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { UserProfile, UserRole } from "@/lib/types";

/**
 * Capa de acceso a la sesión (Data Access Layer).
 *
 * Todo Server Component / Server Action que toque datos privados tiene que
 * pasar por acá: el proxy sirve para redirigir rápido, pero la verificación
 * real va lo más cerca posible del dato.
 *
 * `cache()` de React deduplica las llamadas dentro de un mismo request, así
 * podemos pedir el perfil en varios componentes sin pegarle N veces a la base.
 */

/** Usuario autenticado (tabla auth.users), o null si no hay sesión. */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

/**
 * Perfil completo del usuario logueado (name, role, company_id).
 *
 * Devuelve null SOLO cuando no hay sesión o cuando realmente no existe la fila
 * en `users`. Si la query falla (permisos, recursión en una policy de RLS, etc.)
 * lanzamos el error en vez de devolver null: son problemas de configuración de
 * la base, y disfrazarlos de "perfil inexistente" hace imposible diagnosticarlos.
 */
export const getUserProfile = cache(async (): Promise<UserProfile | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, company_id, name, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `No se pudo leer el perfil de ${user.id} en la tabla users ` +
        `(${error.code}: ${error.message}). Revisá los GRANT y las policies de RLS.`,
      { cause: error },
    );
  }

  if (!data) return null;

  return {
    id: data.id,
    companyId: data.company_id,
    name: data.name,
    email: data.email,
    role: data.role as UserRole,
  };
});

/**
 * Igual que getUser(), pero corta el render y manda a /login si no hay sesión.
 * Usar en layouts/páginas privadas y al principio de cada Server Action.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");

  return user;
}

/**
 * Igual que getUserProfile(), pero exige sesión + perfil cargado.
 * Si hay sesión pero falta la fila en `users`, mandamos al login con un error
 * explicativo (usuario creado en Supabase Auth pero sin dar de alta acá).
 */
export async function requireUserProfile(): Promise<UserProfile> {
  await requireUser();

  const profile = await getUserProfile();
  if (!profile) redirect("/login?error=perfil-incompleto");

  return profile;
}

/** Helper para mostrar/ocultar funcionalidad según el rol. */
export function hasRole(profile: UserProfile, ...roles: UserRole[]): boolean {
  return roles.includes(profile.role);
}
