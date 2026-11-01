import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { PlanChangeForm } from "@/components/account/plan-change-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CurrentCompanyPlan, PlanEquipment } from "@/components/account/plan-comparison";
import { Badge, EmptyState, InlineAlert, PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPlan, getPlanCatalog } from "@/lib/plans/queries";
import { formatPlanPrice, getProvisionalPlan, operatorLimitLabel, palletLimitLabel, PLAN_SELECTION_PARAM } from "@/lib/plans/types";

import { getCompanyPlanUsage } from "@/lib/plans/usage-query";
import { getSubscriptionAccess } from "@/lib/plans/payments-query";
import { isLowerPlan } from "@/lib/plans/usage";
import { planChangeMessages } from "@/lib/plans/change";
import { PlanLimitNotice, UsageSummary } from "@/components/account/plan-usage";

import styles from "@/components/account/account.module.css";

export const metadata: Metadata = { title: "Resumen del plan | TrazFlow" };

export default async function PlanReviewPage({ searchParams }: {
  searchParams: Promise<{ selectedPlan?: string | string[] }>;
}) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");

  const [current, catalog, params, usage, access] = await Promise.all([
    getCompanyPlan(profile.companyId), getPlanCatalog(), searchParams, getCompanyPlanUsage(), getSubscriptionAccess(),
  ]);
  // Validate against fresh server data; a URL never authorizes a subscription.
  const selected = current.available && catalog.available
    ? getProvisionalPlan(catalog.plans, params[PLAN_SELECTION_PARAM], current.plan?.code ?? null)
    : null;
  const comparisonHref = selected
    ? { pathname: "/dashboard/account", query: { [PLAN_SELECTION_PARAM]: selected.code }, hash: "planes" }
    : "/dashboard/account#planes";

  return <div className={`app-page ${styles.page}`}>
    <PageHeader title="Resumen del plan" description="Revisá tu selección antes de confirmar el cambio interno de plan."
      action={<Link href={comparisonHref} prefetch={false} className="button-secondary">Volver a comparar planes</Link>} />
    {!current.available ? <InlineAlert variant="warning">No pudimos consultar el plan actual de tu empresa. Volvé a la comparación para reintentar antes de revisar tu elección.</InlineAlert>
      : !catalog.available ? <InlineAlert variant="warning">No pudimos cargar el catálogo de planes. Volvé a la comparación para reintentar.</InlineAlert>
      : !selected ? <div className="surface"><EmptyState title="Selección no disponible"
        description="Elegí un plan del catálogo distinto del plan actual de tu empresa. El código indicado falta, no es válido o ya no está disponible." /></div>
      : <>
        <CurrentCompanyPlan current={current} comparisonHref={comparisonHref}><UsageSummary result={usage} /></CurrentCompanyPlan>
        {usage.available && current.plan ? <PlanLimitNotice plan={current.plan} usage={usage.usage} context="assigned" /> : null}
        <section className="surface section-stack p-5 sm:p-6" aria-labelledby="selected-plan-title">
          <div>
            <Badge tone="info">Selección provisional</Badge>
            <h2 id="selected-plan-title" className="mt-3 text-2xl font-bold text-stone-950">{selected.name}</h2>
            <p className="plan-price mt-4">{formatPlanPrice(selected.monthlyPriceCents, selected.currency)}{selected.monthlyPriceCents !== null ? <span className="plan-period"> / mes</span> : null}</p>
            <p className="mt-2 text-sm text-stone-600">Moneda: {selected.currency}</p>
          </div>
          <dl className="plan-limits sm:grid-cols-2">
            <div><dt>Operadores</dt><dd>{operatorLimitLabel(selected.maxOperators)}</dd></div>
            <div><dt>Pallets</dt><dd>{palletLimitLabel(selected.maxPalletsPerMonth)}</dd></div>
          </dl>
          <p className="text-sm text-stone-600">{current.plan ? `Plan actual de tu empresa: ${current.plan.name}.` : "Tu empresa no tiene un plan asignado."}</p>
        </section>
        {usage.available ? <PlanLimitNotice plan={selected} usage={usage.usage} context={isLowerPlan(catalog.plans, current.plan?.code ?? null, selected.code) ? "lower" : "selected"} /> : null}
        {selected.preliminary ? <p className="text-xs leading-relaxed text-stone-500"><span className="font-medium">Propuesta comercial preliminar</span>. Los precios y límites publicados están pendientes de validación comercial.</p> : null}
        <section className="surface section-stack p-5 sm:p-6" aria-label="Confirmar cambio de plan">
          <p className="text-sm text-stone-600">El cambio actualiza inmediatamente la asignación interna de la empresa. No representa una contratación formal ni genera cobros. Conserva los datos y el consumo acumulado.</p>
          {!current.plan ? <InlineAlert variant="info">Tu empresa no tiene un plan asignado. La asignación inicial requiere gestión administrativa.</InlineAlert>
            : access.canceledAt ? <InlineAlert variant="info">{planChangeMessages.subscription_canceled}</InlineAlert>
            : selected.monthlyPriceCents === null ? <><InlineAlert variant="info">Este plan requiere gestión comercial y no puede activarse automáticamente.</InlineAlert><button className="button-primary" disabled>Requiere gestión comercial</button></>
            : !current.assignedAt ? <InlineAlert variant="warning">No pudimos verificar la versión del plan actual. Actualizá la página antes de confirmar.</InlineAlert>
            : <PlanChangeForm targetCode={selected.code} expectedCode={current.plan.code} assignedAt={current.assignedAt} requestId={randomUUID()} lower={isLowerPlan(catalog.plans, current.plan.code, selected.code)} />}
        </section>
        <PlanEquipment plans={[selected]} />
      </>}
  </div>;
}
