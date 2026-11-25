import { PalletContentList } from "@/components/pallets/content-list";
import Link from "next/link";
import { PalletQrButton } from "@/components/pallets/pallet-qr-button";
import { EventTimeline } from "@/components/traceability/event-timeline";
import { TimelineExportActions } from "@/components/traceability/timeline-export";
import type { TimelineEntry } from "@/lib/traceability/timeline";

import type { PalletTraceability as PalletTraceabilityData } from "@/lib/traceability/types";
import { PalletStatusBadge } from "@/components/ui/design-system";

type PalletTraceabilityProps = {
  traceability: PalletTraceabilityData;
  timeline: TimelineEntry[];
  canPrint?: boolean;
};

/** Estado actual del pallet y su línea de tiempo unificada (TRZ-57). */
export function PalletTraceability({
  traceability,
  timeline,
  canPrint = true,
}: PalletTraceabilityProps) {
  const { pallet } = traceability;

  return (
    <div className="print-root list-content space-y-6">
      <section className="section-stack">
        <div className="section-header">
          <div className="min-w-0">
            <div className="flex items-center gap-5">
              <h2 className="section-title min-w-0 break-all">Pallet {pallet.qrCode}</h2>
              <span className="no-print"><PalletQrButton pallet={pallet} variant="icon" /></span>
              {canPrint && <Link href={`/dashboard/pallets/print?ids=${pallet.id}`} className="no-print button-secondary button-sm">Imprimir etiqueta</Link>}
            </div>
            <p className="section-description">Identificación y estado actual del pallet.</p>
          </div>
        </div>
        {pallet.contents && pallet.contents.length > 1 && <PalletContentList items={pallet.contents} />}
        <dl className="surface grid gap-5 p-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Producto</dt>
            <dd className="font-semibold text-slate-950">{pallet.productName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">SKU</dt><dd className="font-mono font-semibold text-slate-950">{pallet.productSku}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Lote</dt><dd className="font-mono font-semibold text-slate-950">{pallet.batchNumber}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Estado actual</dt><dd className="font-semibold text-slate-950">
              <PalletStatusBadge status={pallet.status} />
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Ubicación actual</dt><dd className="font-semibold text-slate-950">
              {pallet.currentLocation ?? "Sin ubicación registrada"}
            </dd>
          </div>
        </dl>
      </section>

      <Link href={`/dashboard/locations?pallet=${pallet.id}`} className="no-print button-secondary w-fit">Consultar o actualizar ubicación</Link>
      <EventTimeline entries={timeline} action={<TimelineExportActions excelHref={`/dashboard/traceability/export?qr=${encodeURIComponent(pallet.qrCode)}`} />} />
    </div>
  );
}
