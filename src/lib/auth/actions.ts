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
