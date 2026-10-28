import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CurrentCompanyPlan, PlanComparison, PlanEquipment } from "@/components/account/plan-comparison";
import { InlineAlert, PageHeader, SectionHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPlan, getPlanCatalog } from "@/lib/plans/queries";

export const metadata: Metadata = { title: "Cuenta y plan | TrazFlow" };

export default async function AccountPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [current, catalog] = await Promise.all([getCompanyPlan(profile.companyId), getPlanCatalog()]);

  return <div className="app-page">
    <PageHeader title="Cuenta y plan" description="Consultá el plan de tu empresa y compará precios y límites según tu operación."
      action={<Link href="/dashboard" className="button-secondary">Volver al inicio</Link>} />
    <section className="section-stack" aria-labelledby="account-title">
      <SectionHeader id="account-title" title="Tu cuenta" />
      <dl className="surface detail-fields grid gap-5 p-5 text-sm sm:grid-cols-3">
        <div><dt className="text-stone-500">Nombre</dt><dd className="mt-1 font-semibold">{profile.name}</dd></div>
        <div><dt className="text-stone-500">Email</dt><dd className="mt-1 font-semibold">{profile.email}</dd></div>
        <div><dt className="text-stone-500">Rol activo</dt><dd className="mt-1 font-semibold">Logística</dd></div>
      </dl>
    </section>
    <CurrentCompanyPlan current={current} />
    <section id="planes" className="section-stack" aria-labelledby="plans-title">
      <SectionHeader id="plans-title" title="Compará los planes" description="La suscripción mensual se define por la cantidad de operadores y pallets por mes." />
      {catalog.available ? <PlanComparison plans={catalog.plans} currentCode={current.plan?.code ?? null} />
        : <InlineAlert variant="warning">No pudimos cargar el catálogo de planes. <Link href="/dashboard/account" className="underline">Volvé a intentarlo</Link>.</InlineAlert>}
    </section>
    {catalog.available ? <PlanEquipment plans={catalog.plans} /> : null}
  </div>;
}
