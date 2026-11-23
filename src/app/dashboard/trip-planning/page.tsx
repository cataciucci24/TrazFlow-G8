import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getTripPlans, type DriverTripPlan } from "@/lib/trip-planning/queries";
import type { TripOrderInput } from "@/lib/trip-planning/suggest";
import { Badge, EmptyState, InlineAlert, PageHeader, SectionHeader, SummaryCard, Surface } from "@/components/ui/design-system";
import { VehicleForm } from "./vehicle-form";

export const metadata: Metadata = {
  title: "Planificación de viajes | TrazFlow",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayInArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export default async function TripPlanningPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");

  const params = await searchParams;
  const date = params.date && DATE.test(params.date) && !Number.isNaN(Date.parse(params.date)) ? params.date : todayInArgentina();
  const { plans, vehicles } = await getTripPlans(date);
  const withOrders = plans.filter((plan) => plan.orders.length > 0);
  const overloaded = withOrders.filter((plan) => plan.suggestion && !plan.suggestion.fits);
  const withoutVehicle = withOrders.filter((plan) => !plan.vehicle);

  return (
    <div className="app-page">
      <PageHeader eyebrow="Despacho" title="Planificación de viajes"
        description="Compará los pallets de las órdenes de cada chofer con la capacidad de su vehículo. La sugerencia es informativa: no cambia ninguna orden." />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="form-label">Fecha prevista de despacho
          <input type="date" name="date" defaultValue={date} required className="form-control mt-2" />
        </label>
        <button className="button-secondary">Ver viajes</button>
      </form>

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="CHOFERES CON ÓRDENES" value={String(withOrders.length)} detail={`Hasta el ${formatDate(date)}`} />
        <SummaryCard label="NO ENTRA TODO" value={String(overloaded.length)} tone={overloaded.length ? "critical" : undefined} />
        <SummaryCard label="SIN VEHÍCULO CARGADO" value={String(withoutVehicle.length)} tone={withoutVehicle.length ? "caution" : undefined} />
      </section>

      <section className="section-stack">
        <SectionHeader title="Viajes por chofer"
          description="Incluye las órdenes con esa fecha prevista y las atrasadas que todavía no salieron. Se cargan primero las más antiguas." />
        {withOrders.length === 0
          ? <Surface><EmptyState title="Sin órdenes asignadas" description={`Ningún chofer tiene órdenes pendientes de salir para el ${formatDate(date)}.`} /></Surface>
          : <div className="grid gap-4 lg:grid-cols-2">{withOrders.map((plan) => <TripCard key={plan.driverId} plan={plan} />)}</div>}
      </section>

      <section className="section-stack">
        <SectionHeader title="Vehículos" description="Un vehículo por chofer, con cuántos pallets entran." />
        <Surface className="space-y-4 p-6">
          <VehicleForm drivers={plans.map((plan) => ({ id: plan.driverId, name: plan.driverName }))} vehicles={vehicles} />
          {plans.length === 0 ? <p className="text-sm text-stone-500">La empresa todavía no tiene choferes activos.</p> : (
            <ul className="divide-y divide-stone-200 text-sm">
              {plans.map((plan) => (
                <li key={plan.driverId} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-semibold">{plan.driverName}</span>
                  <span className="text-stone-600">{plan.vehicle ? `${plan.vehicle.name} · ${plan.vehicle.capacityPallets} pallets` : "Sin vehículo"}</span>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </section>
    </div>
  );
}

function TripCard({ plan }: { plan: DriverTripPlan }) {
  const { suggestion, vehicle } = plan;
  return (
    <Surface className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-stone-950">{plan.driverName}</h3>
          <p className="text-sm text-stone-500">{vehicle ? vehicle.name : "Sin vehículo cargado"}</p>
        </div>
        {suggestion
          ? <Badge tone={suggestion.fits ? "success" : "danger"}>{suggestion.totalPallets} / {suggestion.capacityPallets} pallets</Badge>
          : <Badge tone="warning">{plan.orders.reduce((total, order) => total + order.palletCount, 0)} pallets</Badge>}
      </div>

      {!suggestion ? <InlineAlert variant="warning" announce={false}>Cargá el vehículo de este chofer para saber si entra todo.</InlineAlert> : null}
      {suggestion && !suggestion.fits ? (
        <InlineAlert variant="danger" announce={false}>
          No entra todo: {suggestion.totalPallets} pallets para un vehículo de {suggestion.capacityPallets}.
          {suggestion.deferred.length ? ` Sugerencia: pasar ${suggestion.deferred.map((order) => order.label).join(", ")} al próximo viaje o día.` : ""}
          {suggestion.oversized.length ? ` ${suggestion.oversized.map((order) => order.label).join(", ")} sola supera la capacidad: dividila o usá otro vehículo.` : ""}
        </InlineAlert>
      ) : null}

      <ul className="divide-y divide-stone-200 text-sm">
        {(suggestion ? [...suggestion.loaded, ...suggestion.deferred, ...suggestion.oversized] : plan.orders).map((order) => (
          <OrderRow key={order.id} order={order}
            outcome={!suggestion ? null : suggestion.oversized.includes(order) ? "oversized" : suggestion.deferred.includes(order) ? "deferred" : "loaded"} />
        ))}
      </ul>
    </Surface>
  );
}

function OrderRow({ order, outcome }: { order: TripOrderInput; outcome: "loaded" | "deferred" | "oversized" | null }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span>
        <span className="font-mono">{order.label}</span>
        <span className="text-stone-500"> · prevista {formatDate(order.estimatedDate)} · {order.palletCount === 0 ? "sin pallets armados" : order.palletCount === 1 ? "1 pallet" : `${order.palletCount} pallets`}</span>
      </span>
      {outcome === "loaded" ? <Badge tone="success">Entra</Badge> : null}
      {outcome === "deferred" ? <Badge tone="warning">Próximo viaje</Badge> : null}
      {outcome === "oversized" ? <Badge tone="danger">Supera el vehículo</Badge> : null}
    </li>
  );
}
