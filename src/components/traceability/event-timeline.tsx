import Link from "next/link";

import { Badge, EmptyState, SectionHeader } from "@/components/ui/design-system";
import type { TimelineEntry } from "@/lib/traceability/timeline";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const TONE_DOT: Record<TimelineEntry["tone"], string> = {
  neutral: "bg-stone-400",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

/**
 * TRZ-57 / TRZ-58: línea de tiempo unificada (qué, quién y cuándo). Con `showPallet` indica a qué pallet
 * corresponde cada evento, para la vista por lote.
 */
export function EventTimeline({
  entries,
  showPallet = false,
  title = "Línea de tiempo",
  description = "Todo lo que pasó con la mercadería, en orden cronológico. Horarios de Argentina.",
  action,
}: {
  entries: TimelineEntry[];
  showPallet?: boolean;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="section-stack" aria-label={title}>
      <SectionHeader title={title} description={description} action={action} />
      <div className="surface p-5 sm:p-6">
        {entries.length === 0 ? (
          <EmptyState title="Sin eventos registrados" description="Los eventos aparecerán acá a medida que se registren." />
        ) : (
          <ol className="relative space-y-4 border-l border-stone-200 pl-6">
            {entries.map((entry) => (
              <li key={entry.id} className="relative">
                <span aria-hidden="true" className={`absolute -left-[1.95rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${TONE_DOT[entry.tone]}`} />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-semibold text-slate-950">{entry.title}</p>
                  <time dateTime={entry.at} className="text-xs text-slate-500">{DATE_FORMATTER.format(new Date(entry.at))}</time>
                </div>
                {entry.description && <p className="mt-1 text-sm text-slate-700">{entry.description}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{entry.actor ? `Por ${entry.actor}` : entry.eventType === "pallet_created" ? "Alta en TrazFlow" : "Sin usuario registrado"}</span>
                  {showPallet && entry.palletCode && (
                    <Link href={`/dashboard/traceability?qr=${encodeURIComponent(entry.palletCode)}`} className="table-action font-mono">
                      {entry.palletCode}
                    </Link>
                  )}
                  {entry.orderId && (
                    <Link href={`/dashboard/orders/${entry.orderId}`} title={entry.orderId} className="table-action">
                      Orden {entry.orderId.slice(0, 8)}
                    </Link>
                  )}
                  {entry.tone === "danger" && <Badge tone="danger">Diferencia</Badge>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
