"use client";

import { useCallback, useState, useTransition } from "react";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { validatePallet } from "@/lib/pallet-validation/actions";
import type {
  OrderPalletValidation,
  PalletValidationResult,
} from "@/lib/pallet-validation/types";

type PalletValidationPanelProps = {
  orderId: string;
  pallets: OrderPalletValidation[];
};

export function PalletValidationPanel({
  orderId,
  pallets,
}: PalletValidationPanelProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [result, setResult] = useState<PalletValidationResult | null>(null);
  const [incorrectPallets, setIncorrectPallets] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  
  const validatedCount = pallets.filter((pallet) => pallet.validatedAt).length;
  const missingPallets = pallets.filter((pallet) => !pallet.validatedAt);

  const handleScan = useCallback(
    (qrCode: string) => {
      startTransition(async () => {
        const validationResult = await validatePallet(orderId, qrCode);
        
        setResult(validationResult);

        if (validationResult.outcome === "wrong_order") {
          setIncorrectPallets((current) =>
            current.includes(qrCode) ? current : [...current, qrCode],
          );
        }

        setIsScannerOpen(false);
      });
    },
    [orderId],
  );

  const isSuccess = result?.outcome === "validated";
  const isDuplicate = result?.outcome === "already_validated";

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-gray-700">
            Validación de pallets
          </h2>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {validatedCount} de {pallets.length} pallets validados
          </p>
        </div>

        <button
          type="button"
          disabled={isPending || pallets.length === 0}
          onClick={() => {
            setResult(null);
            setIsScannerOpen(true);
          }}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Validando..." : "Escanear QR"}
        </button>
      </div>

      {result && (
        <div
          role={isSuccess ? "status" : "alert"}
          className={`rounded-md border px-3 py-3 text-sm ${
            isSuccess
              ? "border-green-200 bg-green-50 text-green-700"
              : isDuplicate
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

      {pallets.length > 0 && (
        <div
          className={`rounded-md border px-4 py-4 ${
            missingPallets.length === 0 && incorrectPallets.length === 0
              ? "border-green-200 bg-green-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          {missingPallets.length === 0 && incorrectPallets.length === 0 ? (
            <div>
              <p className="font-medium text-green-800">
                Carga sin inconsistencias
              </p>
              <p className="mt-1 text-sm text-green-700">
                Todos los pallets asociados a la orden fueron validados correctamente.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-amber-900">
                Inconsistencias detectadas
              </p>

              {missingPallets.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-amber-900">
                    Pallets faltantes:
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                    {missingPallets.map((pallet) => (
                      <li key={pallet.id}>
                        {pallet.qrCode} — {pallet.productName} ({pallet.productSku})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {incorrectPallets.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-amber-900">
                    Pallets incorrectos:
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                    {incorrectPallets.map((qrCode) => (
                      <li key={qrCode}>{qrCode}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {pallets.length === 0 ? (
        <p className="text-sm text-gray-500">
          La orden todavía no tiene pallets asociados.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {pallets.map((pallet) => (
            <li key={pallet.id} className="flex gap-3 py-3 text-sm">
              <span aria-hidden="true" className="mt-0.5">
                {pallet.validatedAt ? "✅" : "⬜"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{pallet.qrCode}</p>
                <p className="text-gray-500">
                  {pallet.productName} ({pallet.productSku}) · Lote {pallet.batchNumber}
                </p>
              </div>
              <span className="text-xs text-gray-500">
                {pallet.validatedAt ? "Validado" : "Pendiente"}
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
