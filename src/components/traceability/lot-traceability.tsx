import Link from "next/link";

import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { LotTraceability as LotTraceabilityData } from "@/lib/traceability/types";

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
        <div key={lot.batchId} className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Lote {lot.batchNumber}</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Producto</dt>
                <dd className="font-medium text-gray-900">{lot.productName}</dd>
              </div>
              <div>
                <dt className="text-gray-500">SKU</dt>
                <dd className="font-medium text-gray-900">{lot.productSku}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Vencimiento</dt>
                <dd className="font-medium text-gray-900">
                  {lot.expirationDate ? DATE_FORMATTER.format(new Date(lot.expirationDate)) : "Sin definir"}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Pallets asociados</dt>
                <dd className="font-medium text-gray-900">{lot.pallets.length}</dd>
              </div>
            </dl>
          </section>

          {lot.pallets.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
              Este lote todavía no tiene pallets registrados.
            </p>
          ) : (
            lot.pallets.map(({ pallet, movements }) => (
              <section key={pallet.id} className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="text-sm font-semibold text-gray-900">Pallet {pallet.qrCode}</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Estado actual</dt>
                    <dd className="font-medium text-gray-900">{PALLET_STATUS_LABELS[pallet.status]}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Ubicación actual</dt>
                    <dd className="font-medium text-gray-900">{pallet.currentLocation ?? "Sin ubicación registrada"}</dd>
                  </div>
                </dl>

                {movements.length === 0 ? (
                  <p className="mt-4 text-sm text-gray-500">Este pallet todavía no registra movimientos.</p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {movements.map((movement, index) => (
                      <li key={movement.id} className="rounded-md border border-gray-200 p-3 text-sm">
                        <p className="font-medium text-gray-900">
                          {index + 1}. {DATE_TIME_FORMATTER.format(new Date(movement.createdAt))}
                        </p>
                        <div className="my-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                          <span className="text-gray-700">{movement.originLocation ?? "Origen no registrado"}</span>
                          <span aria-hidden="true" className="text-gray-400">→</span>
                          <span className="text-right text-gray-900">{movement.destinationLocation}</span>
                        </div>
                        <dl className="space-y-1 text-gray-500">
                          <div className="flex gap-2">
                            <dt>Estado:</dt>
                            <dd className="text-gray-900">{PALLET_STATUS_LABELS[movement.resultingStatus]}</dd>
                          </div>
                          {movement.orderId && (
                            <div className="flex gap-2">
                              <dt>Orden:</dt>
                              <dd>
                                <Link
                                  href={`/dashboard/orders/${movement.orderId}`}
                                  title={movement.orderId}
                                  className="font-medium text-gray-900 underline hover:text-gray-700"
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
