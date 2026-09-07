import Link from "next/link";

import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import type { PalletTraceability as PalletTraceabilityData } from "@/lib/traceability/types";

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
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Pallet {pallet.qrCode}
        </h2>

        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Producto</dt>
            <dd className="font-medium text-gray-900">{pallet.productName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">SKU</dt>
            <dd className="font-medium text-gray-900">{pallet.productSku}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Lote</dt>
            <dd className="font-medium text-gray-900">{pallet.batchNumber}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Estado actual</dt>
            <dd className="font-medium text-gray-900">
              {PALLET_STATUS_LABELS[pallet.status]}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-gray-500">Ubicación actual</dt>
            <dd className="font-medium text-gray-900">
              {pallet.currentLocation ?? "Sin ubicación registrada"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-medium text-gray-700">
          Historial de movimientos
        </h2>

        {movements.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            Este pallet todavía no registra movimientos.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {movements.map((movement, index) => (
              <li
                key={movement.id}
                className="rounded-md border border-gray-200 p-4 text-sm"
              >
                <p className="font-medium text-gray-900">
                  {index + 1}. {DATE_FORMATTER.format(new Date(movement.createdAt))}
                </p>

                <div className="my-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <span className="text-gray-700">
                    {movement.originLocation ?? "Origen no registrado"}
                  </span>
                  <span aria-hidden="true" className="text-gray-400">
                    →
                  </span>
                  <span className="text-right text-gray-900">
                    {movement.destinationLocation}
                  </span>
                </div>

                <dl className="space-y-1 text-gray-500">
                  <div className="flex gap-2">
                    <dt>Estado:</dt>
                    <dd className="text-gray-900">
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
    </div>
  );
}
