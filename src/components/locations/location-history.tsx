import { getLocationEvents } from "@/lib/locations/queries";
import { SectionHeader } from "@/components/ui/design-system";
export async function LocationHistory({ palletId }: { palletId: string }) {
  const events = await getLocationEvents(palletId);
  const format = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" });
  return <section className="section-stack"><SectionHeader title="Historial de ubicaciones físicas" description="Asignaciones y reubicaciones, en orden cronológico. Horarios de Argentina." />
    <div className="surface space-y-3 p-6">{events.length === 0 ? <p className="text-sm text-stone-500">Sin asignaciones físicas registradas.</p> : <ol className="space-y-3">{events.map((event) => <li key={event.id} className="rounded-xl border border-stone-200 p-4 text-sm">
      <p className="font-semibold">{event.event_type === "location_assigned" ? "Ubicación asignada" : "Ubicación cambiada"} · {format.format(new Date(event.created_at))}</p>
      <p>{event.details.previous_location ?? "Sin ubicación anterior"} → {event.details.new_location}</p>
      <p className="text-stone-500">Responsable: {event.details.user_name || event.user_id}</p>
    </li>)}</ol>}</div>
  </section>;
}
