import Link from "next/link";

import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { PalletTraceability as PalletTraceabilityData } from "@/lib/traceability/types";
import { SectionHeader } from "@/components/ui/design-system";

type PalletTraceabilityProps = {
  traceability: PalletTraceabilityData;
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

/** Presenta el estado actual y el recorrido real registrado en movements. */
export function PalletTraceability({
  traceability,
}: PalletTraceabilityProps) {
  const { pallet, movements } = traceability;

  return (
    <div className="space-y-6">
      <section className="section-stack">
        <SectionHeader title={`Pallet ${pallet.qrCode}`} description="Identificación y estado actual del pallet." />
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
              {PALLET_STATUS_LABELS[pallet.status]}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Ubicación actual</dt><dd className="font-semibold text-slate-950">
              {pallet.currentLocation ?? "Sin ubicación registrada"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="section-stack">
        <SectionHeader title="Historial de movimientos" description="Recorrido cronológico registrado para este pallet." />
        <div className="surface p-5 sm:p-6">

        {movements.length === 0 ? (
          <p className="text-sm text-slate-500">
            Este pallet todavía no registra movimientos.
          </p>
        ) : (
          <ol className="space-y-3">
            {movements.map((movement, index) => (
              <li
                key={movement.id}
                className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm"
              >
                <p className="font-semibold text-slate-950">
                  {index + 1}. {DATE_FORMATTER.format(new Date(movement.createdAt))}
                </p>

                <div className="my-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <span className="text-slate-600">
                    {movement.originLocation ?? "Origen no registrado"}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">
                    →
                  </span>
                  <span className="text-right text-slate-950">
                    {movement.destinationLocation}
                  </span>
                </div>

                <dl className="space-y-1 text-slate-500">
                  <div className="flex gap-2">
                    <dt>Estado:</dt>
                    <dd className="text-slate-950">
                      {PALLET_STATUS_LABELS[movement.resultingStatus]}
                    </dd>
                  </div>
                  {movement.orderId && (
                    <div className="flex gap-2">
                      <dt>Orden:</dt>
                      <dd>
                        <Link
                          href={`/dashboard/orders/${movement.orderId}`}
                          title={movement.orderId}
                          className="table-action"
                        >
                          {movement.orderId.slice(0, 8)}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ol>
        )}
        </div>
      </section>
    </div>
  );
}
