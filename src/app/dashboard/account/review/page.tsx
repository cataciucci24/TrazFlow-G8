import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanEquipment } from "@/components/account/plan-comparison";
import { Badge, EmptyState, InlineAlert, PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPlan, getPlanCatalog } from "@/lib/plans/queries";
import { formatPlanPrice, getProvisionalPlan, operatorLimitLabel, palletLimitLabel, PLAN_SELECTION_PARAM } from "@/lib/plans/types";

export const metadata: Metadata = { title: "Resumen del plan | TrazFlow" };

export default async function PlanReviewPage({ searchParams }: {
  searchParams: Promise<{ selectedPlan?: string | string[] }>;
}) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");

  const [current, catalog, params] = await Promise.all([
    getCompanyPlan(profile.companyId), getPlanCatalog(), searchParams,
  ]);
  // Validate against fresh server data; a URL never authorizes a subscription.
  const selected = current.available && catalog.available
    ? getProvisionalPlan(catalog.plans, params[PLAN_SELECTION_PARAM], current.plan?.code ?? null)
    : null;
  const comparisonHref = selected
    ? { pathname: "/dashboard/account", query: { [PLAN_SELECTION_PARAM]: selected.code }, hash: "planes" }
    : "/dashboard/account#planes";

  return <div className="app-page">
    <PageHeader title="Resumen del plan" description="Revisá tu elección provisional antes de contratar."
      action={<Link href={comparisonHref} prefetch={false} className="button-secondary">Volver a comparar planes</Link>} />
    {!current.available ? <InlineAlert variant="warning">No pudimos consultar el plan actual de tu empresa. Volvé a la comparación para reintentar antes de revisar tu elección.</InlineAlert>
      : !catalog.available ? <InlineAlert variant="warning">No pudimos cargar el catálogo de planes. Volvé a la comparación para reintentar.</InlineAlert>
      : !selected ? <div className="surface"><EmptyState title="Selección no disponible"
        description="Elegí un plan del catálogo distinto del plan actual de tu empresa. El código indicado falta, no es válido o ya no está disponible." /></div>
      : <>
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
        {selected.preliminary ? <InlineAlert variant="info" announce={false}>
          <p className="font-semibold">Propuesta comercial preliminar</p>
          <p className="mt-1">Los precios y límites publicados están pendientes de validación comercial.</p>
        </InlineAlert> : null}
        <PlanEquipment plans={[selected]} />
        <InlineAlert variant="info" announce={false}>
          <p className="font-semibold">Este plan todavía no fue contratado</p>
          <p className="mt-1">La contratación y activación requieren un paso posterior que aún no está disponible. Esta revisión no cambia el plan de tu empresa ni autoriza cobros.</p>
        </InlineAlert>
      </>}
  </div>;
}
