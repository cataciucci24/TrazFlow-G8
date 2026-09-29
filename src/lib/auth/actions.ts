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

  // Validación en el server: el minLength del HTML se saltea fácil.
  if (!email || password.length < 8) {
    redirect("/register?error=" + encodeURIComponent("Email inválido o contraseña de menos de 8 caracteres"));
  }

  const supabase = await createClient(); // usá el mismo helper que usa login()
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect("/register?error=" + encodeURIComponent(error.message));
  }

  // Sin perfil ni rol todavía: cerramos la sesión para evitar el loop con el proxy.
  await supabase.auth.signOut();
  redirect("/login?registered=1");
}