import type { Metadata } from "next";
import { login } from "@/lib/auth/actions";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Ingresar | TrazFlow",
};

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen overflow-hidden bg-[#faf9f7] lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3 text-xl font-bold"><BrandMark />TrazFlow</div>
        <div className="max-w-lg">
          <p className="mb-4 text-sm font-bold tracking-[0.18em] text-amber-400">TRAZABILIDAD LOGÍSTICA</p>
          <h1 className="text-5xl font-bold leading-tight tracking-tight">Cada pallet, siempre bajo control.</h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-300">Gestioná despachos y recepciones con visibilidad completa desde el depósito hasta la distribuidora.</p>
        </div>
        <p className="text-sm text-slate-400">Control de inventario y movimientos en tiempo real.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center lg:hidden"><BrandMark className="size-11" /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Bienvenido a TrazFlow</h1>
          <p className="mt-2 text-sm text-stone-500">
            Ingresá con tu cuenta para continuar
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <form className="space-y-6" action={login}>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-stone-600"
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
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 placeholder-stone-400 outline-none transition-all focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-100"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-stone-600"
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
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 placeholder-stone-400 outline-none transition-all focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-100"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              >
                Ingresar
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-stone-500">
          ¿No tenés cuenta? Las cuentas las crea el administrador.
        </p>
      </div>
      </section>
    </main>
  );
}
