import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { RegistrationFields } from "@/components/registration-fields";
import { getUserProfile, requireUser } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/registration/actions";
import { isRequestedRole, type RegistrationCompany } from "@/lib/registration/options";
import { getRegistrationCompanies, hasRegistrationRequest } from "@/lib/registration/queries";
import { NAME_MAX_LENGTH, normalizeName } from "@/lib/registration/name";

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
  const name = normalizeName(user.user_metadata.name);
  if (existing && name) redirect("/dashboard");

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
              {existing && <p className="text-sm text-stone-600">Tu solicitud ya existe. Completá únicamente tu nombre para que puedan aprobarla.</p>}
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-stone-600">Nombre completo</label>
                <input id="name" name="name" autoComplete="name" required maxLength={NAME_MAX_LENGTH}
                  defaultValue={name ?? ""} className="form-control mt-1" />
              </div>
              {error && <p role="alert" className="feedback feedback-danger">{error === "invalid-selection"
                ? "Ingresá un nombre válido y, si corresponde, una empresa y un rol disponibles."
                : "No pudimos completar el envío de la solicitud. Tu cuenta sigue creada; podés volver a intentar."}</p>}
              {!existing && <RegistrationFields companies={companies} companyId={companyId} role={role} />}
              {!existing && companies.length === 0 && <p className="feedback feedback-warning">No hay empresas disponibles para solicitar acceso.</p>}
              <button type="submit" className="button-primary w-full" disabled={!existing && companies.length === 0}>{existing ? "Guardar nombre y continuar" : "Enviar solicitud"}</button>
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
