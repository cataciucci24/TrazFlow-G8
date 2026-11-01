import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CurrentCompanyPlan, PlanComparison, PlanEquipment } from "@/components/account/plan-comparison";
import { InlineAlert, PageHeader, SectionHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPlan, getPlanCatalog } from "@/lib/plans/queries";

import { getCompanyPlanUsage } from "@/lib/plans/usage-query";
import { PlanLimitNotice, UsageSummary } from "@/components/account/plan-usage";

import styles from "@/components/account/account.module.css";

export const metadata: Metadata = { title: "Cuenta y plan | TrazFlow" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ done?: string | string[] }> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const [current, catalog, usage] = await Promise.all([getCompanyPlan(profile.companyId), getPlanCatalog(), getCompanyPlanUsage()]);
  const params = await searchParams;

  return <div className={`app-page ${styles.page}`}>
    <PageHeader title="Cuenta y plan" description="Consultá el plan de tu empresa y compará precios y límites según tu operación."
      action={<Link href="/dashboard" className="button-secondary">Volver al inicio</Link>} />
    {params.done === "plan-changed" ? <InlineAlert variant="success">El plan de tu empresa se actualizó correctamente.</InlineAlert> : null}
    <CurrentCompanyPlan current={current}><UsageSummary result={usage} /></CurrentCompanyPlan>
    {current.available && current.plan && usage.available ? <PlanLimitNotice plan={current.plan} usage={usage.usage} context="assigned" /> : null}
    <section id="planes" className="section-stack" aria-labelledby="plans-title">
      <SectionHeader id="plans-title" title="Compará los planes" description="La suscripción mensual se define por la cantidad de operadores y pallets por mes." />
      {catalog.available ? <PlanComparison plans={catalog.plans} currentCode={current.plan?.code ?? null} selectionEnabled={current.available} usage={usage} />
        : <InlineAlert variant="warning">No pudimos cargar el catálogo de planes. <Link href="/dashboard/account" className="underline">Volvé a intentarlo</Link>.</InlineAlert>}
    </section>
    {catalog.available ? <PlanEquipment plans={catalog.plans} /> : null}
    <section className="border-t border-stone-200 pt-4" aria-labelledby="account-title">
      <h2 id="account-title" className="sr-only">Tu cuenta</h2>
      <dl className="detail-fields flex flex-wrap gap-x-8 gap-y-3 text-xs">
        <div><dt className="text-stone-500">Nombre</dt><dd className="mt-1 break-all font-medium text-stone-700">{profile.name}</dd></div>
        <div><dt className="text-stone-500">Email</dt><dd className="mt-1 font-semibold">{profile.email}</dd></div>
        <div><dt className="text-stone-500">Rol activo</dt><dd className="mt-1 font-semibold">Logística</dd></div>
      </dl>
    </section>
  </div>;
}
