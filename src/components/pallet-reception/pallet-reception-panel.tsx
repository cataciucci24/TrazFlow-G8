"use client";

import { useCallback, useState, useTransition } from "react";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { receivePallet } from "@/lib/pallet-reception/actions";
import type {
  OrderPalletReception,
  PalletReceptionResult,
} from "@/lib/pallet-reception/types";
import type { ScanHistoryItem } from "@/lib/scans/queries";

type PalletReceptionPanelProps = {
  orderId: string;
  pallets: OrderPalletReception[];
  canReceive: boolean;
  initialScanHistory: ScanHistoryItem[];
};

export function PalletReceptionPanel({
  orderId,
  pallets,
  canReceive,
  initialScanHistory,
}: PalletReceptionPanelProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [result, setResult] = useState<PalletReceptionResult | null>(null);
  const [scanHistory, setScanHistory] = useState<{ code: string; message: string; success: boolean }[]>([]);
  const [isPending, startTransition] = useTransition();

  const receivedCount = pallets.filter((pallet) => pallet.received).length;

  const handleScan = useCallback(
    (qrCode: string) => {
      setIsScannerOpen(false);
      startTransition(async () => {
        const receptionResult = await receivePallet(orderId, qrCode);
        setResult(receptionResult);
        setScanHistory((current) => [{
          code: qrCode,
          message: receptionResult.message,
          success: receptionResult.outcome === "received" || receptionResult.outcome === "already_received",
        }, ...current]);
      });
    },
    [orderId],
  );

  const isSuccess = result?.outcome === "received";
  const isInformative = result?.outcome === "already_received";

  return (
    <div className="space-y-5">
      <div className="grid gap-8 lg:grid-cols-[350px_minmax(0,1fr)]">
        <div>
          <button
          type="button"
          disabled={isPending || !canReceive || pallets.length === 0}
          onClick={() => {
            setResult(null);
            setIsScannerOpen(true);
          }}
          aria-label="Abrir cámara para escanear QR"
          className="group flex aspect-square w-full flex-col items-center justify-center rounded-[22px] bg-slate-900 text-center text-slate-400 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="mb-4 size-11 stroke-slate-500 group-hover:stroke-amber-400" fill="none" strokeWidth="1.5"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>
          <span className="text-base">{isPending ? "Registrando…" : "Tocá para escanear el QR"}</span><span className="mt-2 text-xs text-slate-500">Se abrirá la cámara del dispositivo</span>
          </button>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-bold tracking-[0.08em] text-stone-500">ESTADO DE LA ORDEN</h2>
          <div className="mt-4 flex items-center justify-between"><p className="font-mono font-bold">{orderId.slice(0, 8).toUpperCase()}</p><span className={`rounded-full px-3 py-1 text-xs font-bold ${receivedCount === pallets.length ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{receivedCount === pallets.length ? "Completa ✓" : `${pallets.length - receivedCount} pendientes`}</span></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${pallets.length ? (receivedCount / pallets.length) * 100 : 0}%` }} /></div>
          <p className="mt-2 text-sm text-stone-500">{receivedCount} de {pallets.length} pallets confirmados</p>
          <ul className="mt-3 space-y-2">{pallets.map((pallet) => <li key={pallet.id} className="flex items-center gap-2 text-sm"><span className={pallet.received ? "text-emerald-600" : "text-stone-300"}>{pallet.received ? "●" : "○"}</span><span className="font-mono font-semibold">{pallet.qrCode}</span><span className="truncate text-stone-500">{pallet.productName}</span></li>)}</ul>
        </div>
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
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 px-4">
          {pallets.map((pallet) => (
            <li key={pallet.id} className="flex gap-3 py-3 text-sm">
              <span aria-hidden="true" className="mt-0.5">
                {pallet.received ? "✅" : "⬜"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-slate-950">{pallet.qrCode}</p>
                <p className="text-stone-500">
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

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h3 className="text-xs font-bold tracking-[0.1em] text-stone-500">HISTORIAL DE ESCANEOS ({initialScanHistory.length + scanHistory.length})</h3>
        {initialScanHistory.length === 0 && scanHistory.length === 0 ? <p className="mt-3 text-sm text-stone-500">Sin escaneos registrados.</p> : <ul className="mt-3 space-y-2 text-sm">{scanHistory.map((scan, index) => <li key={`session-${scan.code}-${index}`} className="flex items-center gap-2"><span className={scan.success ? "text-emerald-600" : "text-red-600"}>●</span><span className="font-mono font-semibold">{scan.code}</span><span className="text-stone-500">{scan.message}</span></li>)}{initialScanHistory.map((scan) => <li key={scan.id} className="flex items-center gap-2"><span className="text-emerald-600">●</span><span className="font-mono font-semibold">{scan.qrCode}</span><span className="text-stone-500">Recibido el {new Date(scan.createdAt).toLocaleString("es-AR")}</span></li>)}</ul>}
      </section>

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
