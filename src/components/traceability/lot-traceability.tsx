import Link from "next/link";

import type { LotTraceability as LotTraceabilityData } from "@/lib/traceability/types";
import { EmptyState, PalletStatusBadge, SectionHeader } from "@/components/ui/design-system";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });

type LotTraceabilityProps = {
  lots: LotTraceabilityData[];
};

/**
 * Presenta uno o más lotes (puede haber más de uno si distintos productos
 * comparten el mismo número de lote) junto con cada pallet asociado y su
 * recorrido real registrado en movements.
 */
export function LotTraceability({ lots }: LotTraceabilityProps) {
  return (
    <div className="list-content space-y-8">
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
                  {lot.expirationDate ? DATE_FORMATTER.format(new Date(`${lot.expirationDate}T00:00:00`)) : "Sin definir"}
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
            lot.pallets.map(({ pallet, movements }) => (
              <section key={pallet.id} className="surface p-6">
                <h3 className="text-base font-semibold text-slate-950">Pallet {pallet.qrCode}</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Estado actual</dt><dd className="font-semibold text-slate-950"><PalletStatusBadge status={pallet.status} /></dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Ubicación actual</dt><dd className="font-semibold text-slate-950">{pallet.currentLocation ?? "Sin ubicación registrada"}</dd>
                  </div>
                </dl>

                {movements.length === 0 ? (
                  <EmptyState title="Sin movimientos registrados" description="El recorrido del pallet aparecerá acá a medida que se registren sus movimientos." />
                ) : (
                  <details className="group mt-4">
                    <summary className="flex w-fit list-none items-center gap-2 rounded-lg text-sm font-semibold text-stone-700 hover:text-stone-950 [&::-webkit-details-marker]:hidden">
                      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 5 5 5-5 5" /></svg>
                      Movimientos ({movements.length})
                    </summary>
                    <ol className="mt-3 space-y-3">
                      {movements.map((movement, index) => (
                        <li key={movement.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
                          <p className="font-semibold text-slate-950">
                            {index + 1}. {DATE_TIME_FORMATTER.format(new Date(movement.createdAt))}
                          </p>
                          <div className="my-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                            <span className="text-slate-600">{movement.originLocation ?? "Origen no registrado"}</span><span aria-hidden="true" className="text-slate-400">→</span><span className="text-right text-slate-950">{movement.destinationLocation}</span>
                          </div>
                          <dl className="space-y-1 text-slate-500">
                            <div className="flex flex-wrap gap-2">
                              <dt>Estado:</dt>
                              <dd className="text-slate-950"><PalletStatusBadge status={movement.resultingStatus} /></dd>
                            </div>
                            {movement.orderId && (
                              <div className="flex flex-wrap gap-2">
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
                  </details>
                )}
              </section>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
