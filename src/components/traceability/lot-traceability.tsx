import Link from "next/link";

import { EventTimeline } from "@/components/traceability/event-timeline";
import { TimelineExportActions } from "@/components/traceability/timeline-export";
import { EmptyState, PalletStatusBadge, SectionHeader } from "@/components/ui/design-system";
import type { TimelineEntry } from "@/lib/traceability/timeline";
import type { LotTraceability as LotTraceabilityData } from "@/lib/traceability/types";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });

type LotTraceabilityProps = {
  lots: LotTraceabilityData[];
  /** TRZ-58: línea de tiempo de cada lote (todos sus pallets juntos), por batchId. */
  timelines: Record<string, TimelineEntry[]>;
};

/**
 * Uno o más lotes (puede haber más de uno si distintos productos comparten el número de lote), con sus pallets
 * y una sola línea de tiempo que junta los eventos de todos ellos (TRZ-58).
 */
export function LotTraceability({ lots, timelines }: LotTraceabilityProps) {
  return (
    <div className="print-root list-content space-y-8">
      {lots.map((lot) => (
        <div key={lot.batchId} className="list-content space-y-6">
          <section className="section-stack">
            <SectionHeader title={`Lote ${lot.batchNumber}`} description="Identificación, vencimiento y pallets asociados." />
            <dl className="surface grid gap-5 p-6 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Producto</dt><dd className="font-semibold text-slate-950">{lot.productName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">SKU</dt><dd className="font-mono font-semibold text-slate-950">{lot.productSku}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Vencimiento</dt><dd className="font-semibold text-slate-950">
                  {lot.expirationDate ? DATE_FORMATTER.format(new Date(`${lot.expirationDate}T00:00:00Z`)) : "Sin definir"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Pallets asociados</dt><dd className="font-semibold text-slate-950">{lot.pallets.length}</dd>
              </div>
            </dl>
          </section>

          {lot.pallets.length === 0 ? (
            <div className="surface"><EmptyState title="Lote sin pallets" description="Los pallets registrados para este lote aparecerán acá con su recorrido." /></div>
          ) : (
            <>
              <section className="section-stack">
                <SectionHeader title="Pallets del lote" description="Estado y ubicación actual de cada pallet." />
                <ul className="surface divide-y divide-stone-200 text-sm">
                  {lot.pallets.map(({ pallet }) => (
                    <li key={pallet.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="table-action min-w-0 break-all font-mono">
                        {pallet.qrCode}
                      </Link>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-slate-600">{pallet.currentLocation ?? "Sin ubicación registrada"}</span>
                        <PalletStatusBadge status={pallet.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <EventTimeline
                entries={timelines[lot.batchId] ?? []}
                showPallet
                description="Eventos de todos los pallets del lote, en orden cronológico. Horarios de Argentina."
                action={<TimelineExportActions excelHref={`/dashboard/traceability/export?lote=${encodeURIComponent(lot.batchNumber)}`} />}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
