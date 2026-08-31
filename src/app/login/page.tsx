import type { Metadata } from "next";

import { login } from "@/lib/auth/actions";
import { getUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

export const metadata: Metadata = {
  title: "Ingresar | TrazFlow",
};

// Mensajes para los códigos de error que llegan por ?error=...
const ERROR_MESSAGES: Record<string, string> = {
  "credenciales-invalidas": "Email o contraseña incorrectos.",
  "campos-incompletos": "Completá el email y la contraseña.",
  "perfil-incompleto":
    "Tu usuario existe pero todavía no tiene un perfil asignado. Contactá al administrador.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorCode = typeof error === "string" ? error : undefined;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? "No pudimos iniciar sesión. Intentá de nuevo.")
    : null;

  // Si hay sesión pero igual caímos acá (perfil incompleto), ofrecemos salir.
  const user = errorCode ? await getUser() : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">TrazFlow</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ingresá con tu cuenta para continuar
          </p>
        </div>

        <form
          action={login}
          className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          {errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorMessage}
            </p>
          )}

          <div className="space-y-1">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            Ingresar
          </button>
        </form>

        {user && (
          <div className="mt-4 text-center">
            <LogoutButton className="text-sm text-gray-500 underline hover:text-gray-900">
              Cerrar sesión
            </LogoutButton>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          ¿No tenés cuenta? Las cuentas las crea el administrador.
        </p>
      </div>
    </main>
  );
}
