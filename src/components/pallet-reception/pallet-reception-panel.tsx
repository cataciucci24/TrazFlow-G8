"use client";

import { useCallback, useState, useTransition } from "react";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { receivePallet } from "@/lib/pallet-reception/actions";
import type {
  OrderPalletReception,
  PalletReceptionResult,
} from "@/lib/pallet-reception/types";

type PalletReceptionPanelProps = {
  orderId: string;
  pallets: OrderPalletReception[];
  canReceive: boolean;
};

export function PalletReceptionPanel({
  orderId,
  pallets,
  canReceive,
}: PalletReceptionPanelProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [result, setResult] = useState<PalletReceptionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const receivedCount = pallets.filter((pallet) => pallet.received).length;

  const handleScan = useCallback(
    (qrCode: string) => {
      setIsScannerOpen(false);
      startTransition(async () => {
        const receptionResult = await receivePallet(orderId, qrCode);
        setResult(receptionResult);
      });
    },
    [orderId],
  );

  const isSuccess = result?.outcome === "received";
  const isInformative = result?.outcome === "already_received";

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-gray-700">
            Recepción de pallets
          </h2>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {receivedCount} de {pallets.length} pallets recibidos
          </p>
        </div>

        <button
          type="button"
          disabled={isPending || !canReceive || pallets.length === 0}
          onClick={() => {
            setResult(null);
            setIsScannerOpen(true);
          }}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Registrando..." : "Escanear QR"}
        </button>
      </div>

      {!canReceive && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
          Esta orden no está en tránsito o ya no admite recepciones.
        </p>
      )}

      {result && (
        <div
          role={isSuccess ? "status" : "alert"}
          className={`rounded-md border px-3 py-3 text-sm ${
            isSuccess
              ? "border-green-200 bg-green-50 text-green-700"
              : isInformative
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <p className="font-medium">{result.message}</p>
          {result.pallet && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>Código:</dt>
              <dd>{result.pallet.qrCode}</dd>
              <dt>Producto:</dt>
              <dd>
                {result.pallet.productName} ({result.pallet.productSku})
              </dd>
              <dt>Lote:</dt>
              <dd>{result.pallet.batchNumber}</dd>
            </dl>
          )}
        </div>
      )}

      {pallets.length === 0 ? (
        <p className="text-sm text-gray-500">
          La orden no tiene pallets esperados para recibir.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {pallets.map((pallet) => (
            <li key={pallet.id} className="flex gap-3 py-3 text-sm">
              <span aria-hidden="true" className="mt-0.5">
                {pallet.received ? "✅" : "⬜"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{pallet.qrCode}</p>
                <p className="text-gray-500">
                  {pallet.productName} ({pallet.productSku}) · Lote {pallet.batchNumber}
                </p>
              </div>
              <span className="text-xs text-gray-500">
                {pallet.received ? "Recibido" : "Pendiente"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isScannerOpen && (
        <QrScanner
          disabled={isPending}
          onCancel={() => setIsScannerOpen(false)}
          onScan={handleScan}
        />
      )}
    </div>
  );
}
