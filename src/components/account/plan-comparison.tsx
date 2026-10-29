import Link from "next/link";
import { Badge, EmptyState, InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { formatPlanPrice, operatorLimitLabel, palletLimitLabel, type CompanyPlanResult, type SubscriptionPlan } from "@/lib/plans/types";

export function CurrentCompanyPlan({ current }: { current: CompanyPlanResult }) {
  return <section className="section-stack" aria-labelledby="current-plan-title">
    <SectionHeader id="current-plan-title" title="Plan actual" description="El plan se aplica a toda tu empresa." />
    {!current.available ? <InlineAlert variant="warning">No pudimos consultar el plan de tu empresa. Actualizá la página para intentarlo nuevamente.</InlineAlert>
      : current.plan ? <div className="surface current-plan-panel">
        <div className="min-w-0">
          <Badge tone="success">Tu plan actual</Badge>
          <h3 className="mt-3 text-2xl font-bold text-stone-950">{current.plan.name}</h3>
          <p className="mt-2 text-sm text-stone-600">{operatorLimitLabel(current.plan.maxOperators)}</p>
          <p className="mt-1 text-sm text-stone-600">{palletLimitLabel(current.plan.maxPalletsPerMonth)}</p>
        </div>
        <div className="min-w-0">
          <p className="plan-current-price">{formatPlanPrice(current.plan.monthlyPriceCents, current.plan.currency)}{current.plan.monthlyPriceCents !== null ? <span className="plan-period"> / mes</span> : null}</p>
          <Link href="#planes" className="button-secondary mt-4">Comparar planes</Link>
        </div>
      </div>
      : <div className="surface"><EmptyState title="Sin plan asignado" description="Tu empresa todavía no tiene un plan registrado. Consultá las opciones y sus límites para evaluar cuál se ajusta a tu operación."
        action={<Link href="#planes" className="button-secondary">Ver planes</Link>} /></div>}
  </section>;
}

export function PlanComparison({ plans, currentCode }: { plans: SubscriptionPlan[]; currentCode: string | null }) {
  if (plans.length === 0) return <div className="surface"><EmptyState title="Todavía no hay planes publicados" description="El catálogo de planes aparecerá acá cuando esté disponible." /></div>;
  return <>
    {plans.some((plan) => plan.preliminary) ? <InlineAlert variant="info" announce={false}>
      <p className="font-semibold">Propuesta comercial preliminar</p>
      <p className="mt-1">Los precios y límites publicados están pendientes de validación comercial.</p>
    </InlineAlert> : null}
    <div className="plan-grid">
      {plans.map((plan) => <article key={plan.code} aria-labelledby={`plan-${plan.code}`} className={`surface plan-card ${plan.code === currentCode ? "plan-card-current" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`plan-${plan.code}`} className="text-xl font-bold text-stone-950">{plan.name}</h3>
          {plan.code === currentCode ? <Badge tone="success">Tu plan actual</Badge> : null}
        </div>
        <div className="plan-card-price">
          <p className="plan-price">{formatPlanPrice(plan.monthlyPriceCents, plan.currency)}{plan.monthlyPriceCents !== null ? <span className="plan-period"> / mes</span> : null}</p>
          <p className="mt-1 text-sm text-stone-500">{plan.monthlyPriceCents === null ? "Precio según tu operación" : `Suscripción mensual en ${plan.currency}`}</p>
        </div>
        <dl className="plan-limits">
          <div><dt>Operadores</dt><dd>{operatorLimitLabel(plan.maxOperators)}</dd></div>
          <div><dt>Pallets</dt><dd>{palletLimitLabel(plan.maxPalletsPerMonth)}</dd></div>
        </dl>
      </article>)}
    </div>
  </>;
}

export function PlanEquipment({ plans }: { plans: SubscriptionPlan[] }) {
  if (plans.length === 0) return null;
  return <section id="equipamiento" className="section-stack" aria-labelledby="equipment-title">
    <SectionHeader id="equipment-title" title="Instalación y equipamiento" description="El equipamiento tiene un precio separado de la suscripción mensual." />
    <TableShell label="Equipamiento por plan" mobileLayout="rows">
      <table role="table" aria-label="Equipamiento por plan" className="data-table">
        <thead role="rowgroup"><tr role="row">
          <th role="columnheader" scope="col">Plan</th><th role="columnheader" scope="col">Impresoras incluidas</th><th role="columnheader" scope="col">Modelo</th><th role="columnheader" scope="col">Precio de equipamiento</th>
        </tr></thead>
        <tbody role="rowgroup">{plans.map((plan) => <tr role="row" key={plan.code}>
          <td role="cell" data-label="Plan" className="mobile-primary font-bold">{plan.name}</td>
          <td role="cell" data-label="Impresoras incluidas">{plan.printerCount === null ? "No especificado" : `${plan.printerCount} ${plan.printerCount === 1 ? "unidad" : "unidades"}`}</td>
          <td role="cell" data-label="Modelo">{plan.printerModel}</td>
          <td role="cell" data-label="Precio de equipamiento" className="mobile-priority font-semibold">{formatPlanPrice(plan.equipmentPriceCents, plan.currency)}</td>
        </tr>)}</tbody>
      </table>
    </TableShell>
    <InlineAlert variant="info" announce={false}>
      <p className="font-semibold">Consumibles según uso</p>
      <p className="mt-1">Los rollos de etiquetas adhesivas térmicas se facturan por separado de la suscripción y del equipamiento, según el consumo real de cada depósito.</p>
    </InlineAlert>
  </section>;
}
