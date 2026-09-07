import type { Metadata } from "next";
import { login } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Ingresar | TrazFlow",
};

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6 py-12">
      {/* Luz ambiental roja difuminada en el fondo */}
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/30 blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        
        {/* Encabezado con la marca */}
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">
            TrazFlow
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ingresá con tu cuenta para continuar
          </p>
        </div>

        {/* Tarjeta del Formulario conectada a la Server Action de Supabase */}
        <div className="rounded-3xl border border-zinc-200/20 bg-white p-8 shadow-2xl">
          <form className="space-y-6" action={login}>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700"
              >
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
                  className="w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none transition-all focus:border-red-950 focus:bg-white focus:ring-2 focus:ring-red-950/10"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-700"
              >
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
                  className="w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none transition-all focus:border-red-950 focus:bg-white focus:ring-2 focus:ring-red-950/10"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full rounded-xl bg-[#3d0c11] px-4 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#2b080c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-950 active:scale-[0.99]"
              >
                Ingresar
              </button>
            </div>
          </form>
        </div>

        {/* Nota al pie */}
        <p className="text-center text-xs text-zinc-500">
          ¿No tenés cuenta? Las cuentas las crea el administrador.
        </p>
      </div>
    </main>
  );
}
