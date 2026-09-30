"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

/**
 * Login con email + contraseña.
 *
 * No hay signup: los usuarios los da de alta un admin desde el dashboard de
 * Supabase (Authentication -> Users) y después se inserta su fila en `users`.
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
  redirect("/dashboard");
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
    !["warehouse_operator", "distributor_operator"].includes(role)
  ) {
    redirect("/register?error=" + encodeURIComponent("Datos inválidos"));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    redirect("/register?error=" + encodeURIComponent(error?.message ?? "No se pudo crear la cuenta"));
  }

  // user_id sale de la cuenta recién creada, nunca del formulario
  const { error: reqError } = await supabase.from("access_requests").insert({
    user_id: data.user.id,
    company_id: companyId,
    requested_role: role,
  });
  if (reqError) {
    redirect("/register?error=" + encodeURIComponent("No se pudo enviar la solicitud"));
  }

  await supabase.auth.signOut();
  redirect("/login?registered=1");
}