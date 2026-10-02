"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/** Inicia sesión en el navegador para que Supabase persista la cookie de sesión. */
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setIsPending(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") ?? "").trim(),
      password: String(formData.get("password") ?? ""),
    });

    if (signInError) {
      setError(signInError.code === "email_not_confirmed"
        ? "Confirmá tu email desde el correo recibido antes de iniciar sesión."
        : "El email o la contraseña no son correctos.");
      setIsPending(false);
      return;
    }

    router.replace("/complete-registration");
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-stone-600">
          Email
        </label>
        <div className="mt-1">
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="nombre@empresa.com"
            className="form-control mt-1"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-stone-600">
          Contraseña
        </label>
        <div className="mt-1">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="form-control mt-1"
          />
        </div>
      </div>

      {error && <p role="alert" className="feedback border-red-200 bg-red-50 text-red-700">{error}</p>}

      <button type="submit" className="button-primary w-full" disabled={isPending}>
        {isPending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
