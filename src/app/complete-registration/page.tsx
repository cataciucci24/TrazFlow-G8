import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { RegistrationFields } from "@/components/registration-fields";
import { NewCompanyFields } from "@/components/new-company-fields";
import { getAccessRequest } from "@/lib/access-requests/queries";
import type { AccessRequest } from "@/lib/access-requests/types";
import { getUserProfile, requireUser } from "@/lib/auth/session";
import { completeRegistration, createCompanyRegistration } from "@/lib/registration/actions";
import { companyErrorMessages, isCompanyError, isRegistrationMode, type RegistrationMode, type SignupPlan } from "@/lib/registration/company";
import { isRequestedRole, type RegistrationCompany } from "@/lib/registration/options";
import { getRegistrationCompanies } from "@/lib/registration/queries";
import { getSignupPlans } from "@/lib/registration/signup-plans";
import { formatPlanPrice, operatorLimitLabel, palletLimitLabel } from "@/lib/plans/types";
import { NAME_MAX_LENGTH, normalizeName } from "@/lib/registration/name";

export const metadata: Metadata = { title: "Completar solicitud | TrazFlow" };

const metadataText = (value: unknown) => (typeof value === "string" ? value : "");

export default async function CompleteRegistrationPage({ searchParams }: {
  searchParams: Promise<{ error?: string; mode?: string }>;
}) {
  const user = await requireUser();
  if (await getUserProfile()) redirect("/dashboard");
  const params = await searchParams;
  const name = normalizeName(user.user_metadata.name);

  let request: AccessRequest | null = null;
  let failed = false;
  try {
    request = await getAccessRequest(user.id);
  } catch (cause) {
    console.error("Error cargando la finalización del registro", cause);
    failed = true;
  }

  // TRZ-112: con la solicitud rechazada se puede dar de alta la empresa propia; con una pendiente o
  // aprobada, no (la RPC también lo rechaza).
  const canCreateCompany = !failed && (request === null || request.status === "rejected");
  const preferred: RegistrationMode = isRegistrationMode(params.mode) ? params.mode
    : user.user_metadata.registration_mode === "new" ? "new" : "join";
  const mode: RegistrationMode = canCreateCompany && preferred === "new" ? "new" : "join";
  const existing = request !== null && mode === "join";
  if (existing && name) redirect("/dashboard");

  let companies: RegistrationCompany[] = [];
  let plans: SignupPlan[] = [];
  if (!failed) {
    try {
      if (mode === "new") plans = await getSignupPlans();
      else if (!existing) companies = await getRegistrationCompanies();
    } catch (cause) {
      console.error("Error cargando la finalización del registro", cause);
      failed = true;
    }
  }

  // La metadata es entrada del usuario: únicamente prellena opciones válidas.
  const companyId = companies.some((company) => company.id === user.user_metadata.company_id)
    ? String(user.user_metadata.company_id) : "";
  const role = isRequestedRole(user.user_metadata.requested_role)
    ? user.user_metadata.requested_role : "";
  const planCode = plans.some((plan) => plan.code === user.user_metadata.plan_code)
    ? String(user.user_metadata.plan_code) : "";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{mode === "new" ? "Dá de alta tu empresa" : "Completá tu solicitud"}</h1>
          <p className="mt-2 text-sm text-stone-500">{mode === "new"
            ? "Revisá los datos de la empresa y elegí un plan. Vas a quedar como responsable logístico."
            : "Revisá la empresa y el rol que querés solicitar."}</p>
        </div>
        <section className="surface space-y-6 p-6 sm:p-8">
          <p className="break-words text-sm text-stone-500">{user.email}</p>
          {failed ? <p role="alert" className="feedback feedback-danger">No pudimos cargar los datos. Volvé a intentar.</p>
            : mode === "new" ? (
              <form action={createCompanyRegistration} className="space-y-6">
                {request?.status === "rejected" && <p className="text-sm text-stone-600">Tu solicitud anterior fue rechazada. Podés dar de alta tu propia empresa.</p>}
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-stone-600">Tu nombre completo</label>
                  <input id="name" name="name" autoComplete="name" required maxLength={NAME_MAX_LENGTH}
                    defaultValue={name ?? ""} className="form-control mt-1" />
                </div>
                <NewCompanyFields companyName={metadataText(user.user_metadata.company_name)}
                  taxId={metadataText(user.user_metadata.company_tax_id)} />
                <PlanOptions plans={plans} planCode={planCode} />
                {params.error && <p role="alert" className="feedback feedback-danger">{isCompanyError(params.error)
                  ? companyErrorMessages[params.error] : companyErrorMessages["company-failed"]}</p>}
                <button type="submit" className="button-primary w-full" disabled={plans.length === 0}>Dar de alta la empresa</button>
              </form>
            ) : (
              <form action={completeRegistration} className="space-y-6">
                {existing && <p className="text-sm text-stone-600">Tu solicitud ya existe. Completá únicamente tu nombre para que puedan aprobarla.</p>}
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-stone-600">Nombre completo</label>
                  <input id="name" name="name" autoComplete="name" required maxLength={NAME_MAX_LENGTH}
                    defaultValue={name ?? ""} className="form-control mt-1" />
                </div>
                {params.error && <p role="alert" className="feedback feedback-danger">{params.error === "invalid-selection"
                  ? "Ingresá un nombre válido y, si corresponde, una empresa y un rol disponibles."
                  : "No pudimos completar el envío de la solicitud. Tu cuenta sigue creada; podés volver a intentar."}</p>}
                {!existing && <RegistrationFields companies={companies} companyId={companyId} role={role} />}
                {!existing && companies.length === 0 && <p className="feedback feedback-warning">No hay empresas disponibles para solicitar acceso.</p>}
                <button type="submit" className="button-primary w-full" disabled={!existing && companies.length === 0}>{existing ? "Guardar nombre y continuar" : "Enviar solicitud"}</button>
              </form>
            )}
          {canCreateCompany && (mode === "new"
            ? request === null && <p className="text-sm text-stone-600">¿Tu empresa ya usa TrazFlow?{" "}
              <Link href="/complete-registration?mode=join" className="font-semibold text-slate-950 underline underline-offset-2">Sumarme a una empresa</Link></p>
            : <p className="text-sm text-stone-600">¿Tu empresa todavía no usa TrazFlow?{" "}
              <Link href="/complete-registration?mode=new" className="font-semibold text-slate-950 underline underline-offset-2">Dar de alta mi empresa</Link></p>)}
          <div className="flex flex-wrap gap-3">
            {failed && <a href="/complete-registration" className="button-secondary">Reintentar</a>}
            <LogoutButton />
          </div>
        </section>
      </div>
    </main>
  );
}

function PlanOptions({ plans, planCode }: { plans: SignupPlan[]; planCode: string }) {
  if (plans.length === 0) return <p className="feedback feedback-warning">No hay planes disponibles para el alta en este momento.</p>;
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-stone-600">Plan</legend>
      {plans.map((plan, index) => (
        <label key={plan.code} className="surface flex cursor-pointer gap-3 p-4 has-[:checked]:border-sky-600 has-[:checked]:ring-1 has-[:checked]:ring-sky-600">
          <input type="radio" name="planCode" value={plan.code} required defaultChecked={planCode ? plan.code === planCode : index === 0}
            className="mt-1" />
          <span className="min-w-0">
            <span className="block font-bold text-stone-950">{plan.name} · {formatPlanPrice(plan.monthlyPriceCents, plan.currency)}<span className="font-normal text-stone-500"> / mes</span></span>
            <span className="mt-1 block text-sm text-stone-600">{operatorLimitLabel(plan.maxOperators)} · {palletLimitLabel(plan.maxPalletsPerMonth)}</span>
          </span>
        </label>
      ))}
      <p className="text-xs leading-relaxed text-stone-500">
        Podés cambiar de plan después desde «Tu cuenta». Para Enterprise, comunicate con el equipo comercial.
      </p>
    </fieldset>
  );
}
