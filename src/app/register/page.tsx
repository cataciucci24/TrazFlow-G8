import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";
import { getRegistrationCompanies } from "@/lib/registration/queries";
import { RegisterWizard } from "./register-wizard";

export const metadata: Metadata = { title: "Crear cuenta | TrazFlow" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const companies = await getRegistrationCompanies();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Crear cuenta</h1>
          <p className="mt-2 text-sm text-stone-500">Registrate para solicitar acceso a TrazFlow</p>
        </div>

        <div className="surface p-6 sm:p-8">
          <RegisterWizard companies={companies ?? []} error={error} />
        </div>

        <p className="text-center text-sm text-stone-500">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="font-semibold text-slate-950 underline underline-offset-2">Ingresá</Link>
        </p>
      </div>
    </main>
  );
}
