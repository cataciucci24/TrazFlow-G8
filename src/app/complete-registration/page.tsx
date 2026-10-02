import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { RegistrationFields } from "@/components/registration-fields";
import { getUserProfile, requireUser } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/registration/actions";
import { isRequestedRole, type RegistrationCompany } from "@/lib/registration/options";
import { getRegistrationCompanies, hasRegistrationRequest } from "@/lib/registration/queries";

export const metadata: Metadata = { title: "Completar solicitud | TrazFlow" };

export default async function CompleteRegistrationPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (await getUserProfile()) redirect("/dashboard");
  const { error } = await searchParams;
  let existing = false;
  let failed = false;
  let companies: RegistrationCompany[] = [];
  try {
    existing = await hasRegistrationRequest(user.id);
    if (!existing) companies = await getRegistrationCompanies();
  } catch (cause) {
    console.error("Error cargando la finalización del registro", cause);
    failed = true;
  }
  if (existing) redirect("/dashboard");

  // La metadata es entrada del usuario: únicamente prellena opciones válidas.
  const companyId = companies.some((company) => company.id === user.user_metadata.company_id)
    ? String(user.user_metadata.company_id) : "";
  const role = isRequestedRole(user.user_metadata.requested_role)
    ? user.user_metadata.requested_role : "";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Completá tu solicitud</h1>
          <p className="mt-2 text-sm text-stone-500">Revisá la empresa y el rol que querés solicitar.</p>
        </div>
        <section className="surface space-y-6 p-6 sm:p-8">
          <p className="break-words text-sm text-stone-500">{user.email}</p>
          {failed ? <p role="alert" className="feedback feedback-danger">No pudimos cargar los datos. Volvé a intentar.</p> : (
            <form action={completeRegistration} className="space-y-6">
              {error && <p role="alert" className="feedback feedback-danger">{error === "invalid-selection"
                ? "Elegí una empresa y un rol disponibles."
                : "No pudimos completar el envío de la solicitud. Tu cuenta sigue creada; podés volver a intentar."}</p>}
              <RegistrationFields companies={companies} companyId={companyId} role={role} />
              {companies.length === 0 && <p className="feedback feedback-warning">No hay empresas disponibles para solicitar acceso.</p>}
              <button type="submit" className="button-primary w-full" disabled={companies.length === 0}>Enviar solicitud</button>
            </form>
          )}
          <div className="flex flex-wrap gap-3">
            {failed && <a href="/complete-registration" className="button-secondary">Reintentar</a>}
            <LogoutButton />
          </div>
        </section>
      </div>
    </main>
  );
}
