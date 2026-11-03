import { InlineAlert } from "@/components/ui/design-system";
import { exceededPlanLimits, type PlanUsageResult, type PlanUsage } from "@/lib/plans/usage";
import type { SubscriptionPlan } from "@/lib/plans/types";

export function UsageSummary({ result }: { result: PlanUsageResult }) {
  if (!result.available) return <InlineAlert variant="warning">No pudimos consultar el consumo. No podemos verificar los límites del plan. Actualizá la página para reintentar.</InlineAlert>;
  const { usage } = result;
  return <div className="space-y-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-stone-800">Consumo actual</h3>
      <span className="text-xs text-stone-500">{usage.monthStart.slice(0, 7)} · Argentina</span>
    </div>
    <dl className="grid grid-cols-2 gap-4">
      <div>
        <dt className="text-xs text-stone-500">Operadores activos</dt>
        <dd className="mt-1 text-2xl font-semibold tracking-tight text-stone-950">{usage.operators.toLocaleString("es-AR")}</dd>
        <dd className="mt-1 text-xs text-stone-500">Depósito y chofer</dd>
      </div>
      <div>
        <dt className="text-xs text-stone-500">Pallets del mes</dt>
        <dd className="mt-1 text-2xl font-semibold tracking-tight text-stone-950">{!usage.palletsComplete ? <span className="mr-1 text-xs font-normal tracking-normal text-stone-500">al menos</span> : null}{usage.pallets.toLocaleString("es-AR")}</dd>
        <dd className="mt-1 text-xs text-stone-500">Incluye eliminados desde el inicio del registro</dd>
      </div>
    </dl>
    {!usage.palletsComplete ? <InlineAlert variant="warning" announce={false}>
      <p className="font-medium">El consumo de pallets de este mes puede estar incompleto.</p>
      <p className="mt-1 text-xs leading-relaxed">No se pueden reconstruir los eliminados antes del inicio del registro. Una cifra dentro del límite no garantiza disponibilidad de cupo.</p>
    </InlineAlert> : null}
  </div>;
}

export function PlanLimitNotice({ plan, usage, context }: {
  plan: SubscriptionPlan; usage: PlanUsage; context: "assigned" | "selected" | "lower";
}) {
  const limits = exceededPlanLimits(plan, usage);
  if (limits.length === 0) return null;
  const label = context === "assigned" ? "plan asignado" : context === "lower" ? "plan inferior seleccionado" : "plan seleccionado provisionalmente";
  return <InlineAlert variant="danger">
    <div className="flex items-start gap-3">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mt-0.5 size-5 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      <div className="min-w-0 space-y-2">
        <p className="font-semibold">Tu uso supera los límites del {label}: {plan.name}.</p>
        <ul className="list-disc space-y-1 pl-4">{limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
        <p className="text-xs leading-relaxed">{context === "lower" ? "Tu uso actual excede la capacidad de este plan. Este aviso no bloquea la selección ni cambia tu plan." : "Evaluá un plan con mayor capacidad. Este aviso no bloquea operaciones ni cambia tu plan."}</p>
      </div>
    </div>
  </InlineAlert>;
}
