import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-mark";
import { LoginForm } from "@/app/login/login-form";
import Link from "next/link";
import { InlineAlert } from "@/components/ui/design-system";

export const metadata: Metadata = {
  title: "Ingresar | TrazFlow",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ registered?: string }> }) {
  const { registered } = await searchParams;
  return (
    <main className="relative grid min-h-dvh overflow-hidden bg-stone-50 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden bg-stone-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <BrandLogo inverse />
        <div className="max-w-lg">
          <p className="mb-4 text-sm font-bold tracking-[0.18em] text-[var(--brand-on-dark)]">TRAZABILIDAD LOGÍSTICA</p>
          <h1 className="text-5xl font-bold leading-tight tracking-tight">Cada pallet, siempre bajo control.</h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-300">Gestioná despachos y recepciones con visibilidad completa desde el depósito hasta la distribuidora.</p>
        </div>
        <p className="text-sm text-slate-400">Control de inventario y movimientos en tiempo real.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center lg:hidden"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Bienvenido a TrazFlow</h1>
          <p className="mt-2 text-sm text-stone-500">
            Ingresá con tu cuenta para continuar
          </p>
        </div>

        <div className="surface p-6 sm:p-8">
          {registered === "1" && <InlineAlert variant="success" className="mb-6">Solicitud de acceso enviada. Podrás ingresar cuando sea aprobada.</InlineAlert>}
          <LoginForm />
        </div>

      <p className="text-center text-sm text-stone-500">
        ¿No tenés cuenta?{" "}
        <Link href="/register" className="font-semibold text-slate-950 underline underline-offset-2">
          Registrate
        </Link>
      </p>
      </div>
      </section>
    </main>
  );
}
