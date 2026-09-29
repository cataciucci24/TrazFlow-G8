import type { Metadata } from "next";
import Link from "next/link";
import { signUp } from "@/lib/auth/actions";
import { BrandLogo } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Crear cuenta | TrazFlow",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Crear cuenta</h1>
          <p className="mt-2 text-sm text-stone-500">Registrate para solicitar acceso a TrazFlow</p>
        </div>

        <div className="surface p-6 sm:p-8">
          <form className="space-y-6" action={signUp}>
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-stone-600">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required
                placeholder="nombre@empresa.com" className="form-control mt-1" />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-stone-600">Contraseña</label>
              <input id="password" name="password" type="password" autoComplete="new-password"
                required minLength={8} placeholder="Mínimo 8 caracteres" className="form-control mt-1" />
            </div>

            <button type="submit" className="button-primary w-full">Crear cuenta</button>
          </form>
        </div>

        <p className="text-center text-sm text-stone-500">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="font-semibold text-slate-950 underline underline-offset-2">Ingresá</Link>
        </p>
      </div>
    </main>
  );
}