import Link from "next/link";

import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { LotTraceability as LotTraceabilityData } from "@/lib/traceability/types";
import { SectionHeader } from "@/components/ui/design-system";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });

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
    <div className="space-y-8">
      {lots.map((lot) => (
        <div key={lot.batchId} className="space-y-6">
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
                  {lot.expirationDate ? DATE_FORMATTER.format(new Date(lot.expirationDate)) : "Sin definir"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Pallets asociados</dt><dd className="font-semibold text-slate-950">{lot.pallets.length}</dd>
              </div>
            </dl>
          </section>

          {lot.pallets.length === 0 ? (
            <p className="surface p-6 text-sm text-slate-500">
              Este lote todavía no tiene pallets registrados.
            </p>
          ) : (
            lot.pallets.map(({ pallet, movements }) => (
              <section key={pallet.id} className="surface p-6">
                <h3 className="text-base font-semibold text-slate-950">Pallet {pallet.qrCode}</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Estado actual</dt><dd className="font-semibold text-slate-950">{PALLET_STATUS_LABELS[pallet.status]}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Ubicación actual</dt><dd className="font-semibold text-slate-950">{pallet.currentLocation ?? "Sin ubicación registrada"}</dd>
                  </div>
                </dl>

                {movements.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">Este pallet todavía no registra movimientos.</p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {movements.map((movement, index) => (
                      <li key={movement.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
                        <p className="font-semibold text-slate-950">
                          {index + 1}. {DATE_TIME_FORMATTER.format(new Date(movement.createdAt))}
                        </p>
                        <div className="my-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                          <span className="text-slate-600">{movement.originLocation ?? "Origen no registrado"}</span><span aria-hidden="true" className="text-slate-400">→</span><span className="text-right text-slate-950">{movement.destinationLocation}</span>
                        </div>
                        <dl className="space-y-1 text-slate-500">
                          <div className="flex gap-2">
                            <dt>Estado:</dt>
                            <dd className="text-slate-950">{PALLET_STATUS_LABELS[movement.resultingStatus]}</dd>
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
              </section>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
