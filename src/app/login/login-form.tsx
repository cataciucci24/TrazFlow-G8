"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/** Inicia sesión en el navegador para que Supabase persista la cookie de sesión. */
export function LoginForm() {
  const router = useRouter();
  const submitLocked = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    if (submitLocked.current) return;
    submitLocked.current = true;
    setError(null);
    setIsPending(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
      });

      if (signInError) {
        setError(signInError.code === "email_not_confirmed"
          ? "Confirmá tu email desde el correo recibido antes de iniciar sesión."
          : "El email o la contraseña no son correctos.");
        submitLocked.current = false;
        setIsPending(false);
        return;
      }

      router.replace("/complete-registration");
      router.refresh();
    } catch {
      setError("No se pudo ingresar. Revisá tu conexión e intentá nuevamente.");
      submitLocked.current = false;
      setIsPending(false);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-6" aria-busy={isPending}>
      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-stone-600">
          Email
        </label>
        <div className="mt-1">
          <input
            id="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            disabled={isPending}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            disabled={isPending}
            required
            placeholder="••••••••"
            className="form-control mt-1"
          />
        </div>
      </div>

      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      <button type="submit" className="button-primary w-full" disabled={isPending} aria-busy={isPending}>
        {isPending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
