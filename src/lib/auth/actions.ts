"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isRequestedRole } from "@/lib/registration/options";
import { getRegistrationCompanies } from "@/lib/registration/queries";

/**
 * Login con email + contraseña.
 *
 * Después del login se resuelve si corresponde completar el registro.
 */
export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=campos-incompletos");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // No distinguimos "usuario inexistente" de "contraseña incorrecta" a propósito,
  // para no filtrar qué emails están registrados.
  if (error) {
    redirect("/login?error=credenciales-invalidas");
  }

  // Limpiamos el cache del router para que el layout privado vea la sesión nueva.
  revalidatePath("/", "layout");
  redirect("/complete-registration");
}

/** Cierra la sesión y vuelve al login. */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}


export async function signUp(formData: FormData) {
  // Acción pública: no lleva requireUserProfile(), el usuario todavía no existe.
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  const role = String(formData.get("role") ?? "");

  // Validar todo en el server: lo que manda el cliente no es confiable
  if (
    !email ||
    password.length < 8 ||
    !companyId ||
    !isRequestedRole(role)
  ) {
    redirect("/register?error=" + encodeURIComponent("Datos inválidos"));
  }

  let companies;
  try {
    companies = await getRegistrationCompanies();
  } catch (error) {
    console.error("No se pudieron validar las empresas del registro", error);
    redirect("/register?error=" + encodeURIComponent("No pudimos validar la empresa. Intentá nuevamente."));
  }
  if (!companies.some((company) => company.id === companyId)) {
    redirect("/register?error=" + encodeURIComponent("Elegí una empresa disponible."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { company_id: companyId, requested_role: role } },
  });
  if (error || !data.user) {
    console.error("Error creando cuenta", { code: error?.code, status: error?.status });
    const message = error?.status === 429
      ? "Esperá unos instantes antes de volver a intentar el registro."
      : "No pudimos completar el registro. Revisá tus datos o intentá iniciar sesión si ya tenés cuenta.";
    redirect("/register?error=" + encodeURIComponent(message));
  }

  // La metadata solo recuerda la selección: no crea solicitud ni concede acceso.
  // También mantenemos login explícito si otro entorno devuelve sesión al registrarse.
  if (data.session) await supabase.auth.signOut();
  redirect(data.session ? "/login?registered=1" : "/login?verify-email=1");
}
