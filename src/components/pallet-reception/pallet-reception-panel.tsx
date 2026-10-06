"use client";

import { Modal } from "@/components/ui/modal";
import { Badge, EmptyState, InlineAlert } from "@/components/ui/design-system";

import { useCallback, useState, useTransition } from "react";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { receivePallet } from "@/lib/pallet-reception/actions";
import type {
  OrderPalletReception,
  ReceptionDiscrepancyType,
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
  const [pendingQrCode, setPendingQrCode] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [result, setResult] = useState<PalletReceptionResult | null>(null);
  const [scanHistory, setScanHistory] = useState<{ code: string; message: string; success: boolean }[]>([]);
  const [isPending, startTransition] = useTransition();

  const receivedCount = pallets.filter((pallet) => pallet.received).length;

  const submitReception = useCallback(
    (qrCode: string, discrepancyType: ReceptionDiscrepancyType | null) => {
      startTransition(async () => {
        setSubmissionError(null);
        try {
          const receptionResult = await receivePallet(orderId, qrCode, discrepancyType);
          setResult(receptionResult);
          setPendingQrCode(null);
          setScanHistory((current) => [{
            code: qrCode,
            message: receptionResult.message,
            success: receptionResult.outcome === "received" || receptionResult.outcome === "already_received",
          }, ...current]);
        } catch {
          setSubmissionError("No se pudo registrar la recepción. Intentá nuevamente.");
        }
      });
    },
    [orderId],
  );

  const handleScan = useCallback((qrCode: string) => {
    setIsScannerOpen(false);
    setSubmissionError(null);
    // Un pallet que no es de la orden no se clasifica a mano: la base lo
    // registra como "no corresponde al pedido" (evento + notificación).
    if (!pallets.some((pallet) => pallet.qrCode === qrCode.trim())) {
      submitReception(qrCode, null);
      return;
    }
    setPendingQrCode(qrCode);
  }, [pallets, submitReception]);

  const confirmReception = useCallback(
    (discrepancyType: ReceptionDiscrepancyType | null) => {
      if (!pendingQrCode || isPending) return;
      submitReception(pendingQrCode, discrepancyType);
    },
    [pendingQrCode, isPending, submitReception],
  );

  const isSuccess = result?.outcome === "received";
  const isInformative = result?.outcome === "already_received";

  return (
    <div className="list-content space-y-5">
      <div className="grid gap-8 lg:grid-cols-[350px_minmax(0,1fr)]">
        <div>
          <button
          type="button"
          disabled={isPending || !canReceive || pallets.length === 0} aria-busy={isPending}
          onClick={() => {
            setResult(null);
            setIsScannerOpen(true);
          }}
          aria-label="Abrir cámara para escanear QR"
          className="scanner-trigger group"
        >
          <svg viewBox="0 0 24 24" className="mb-4 size-11 stroke-stone-500 group-hover:stroke-[var(--brand)]" fill="none" strokeWidth="1.5"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>
          <span className="text-base">{isPending ? "Registrando…" : "Tocá para escanear el QR"}</span><span className="mt-2 text-xs text-slate-500">Se abrirá la cámara del dispositivo</span>
          </button>
        </div>
        <div className="surface p-5">
          <h2 className="text-sm font-bold tracking-[0.08em] text-stone-500">ESTADO DE LA ORDEN</h2>
          <div className="mt-4 flex items-center justify-between"><p className="font-mono font-bold">{orderId.slice(0, 8).toUpperCase()}</p><Badge tone={receivedCount === pallets.length ? "success" : "warning"}>{receivedCount === pallets.length ? "COMPLETA" : `${pallets.length - receivedCount} PENDIENTES`}</Badge></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${pallets.length ? (receivedCount / pallets.length) * 100 : 0}%` }} /></div>
          <p className="mt-2 text-sm text-stone-500">{receivedCount} de {pallets.length} pallets confirmados</p>
          <ul className="mt-3 space-y-2">{pallets.map((pallet) => <li key={pallet.id} className="flex flex-wrap items-center gap-2 text-sm"><span className={pallet.received ? "text-emerald-600" : "text-stone-300"}>{pallet.received ? "●" : "○"}</span><span className="min-w-0 break-all font-mono font-semibold">{pallet.qrCode}</span><span className="min-w-0 text-stone-500">{pallet.productName}</span></li>)}</ul>
        </div>
      </div>

      {!canReceive && (
        <InlineAlert>
          Esta orden no está en tránsito o ya no admite recepciones.
        </InlineAlert>
      )}

      {submissionError && !pendingQrCode && (
        <InlineAlert variant="danger">{submissionError}</InlineAlert>
      )}

      {result && (
        <InlineAlert variant={isSuccess ? "success" : isInformative ? "warning" : "danger"}>
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
        </InlineAlert>
      )}

      {pallets.length === 0 ? (
        <EmptyState title="Orden sin pallets" description="Los pallets asociados a esta orden aparecerán acá cuando estén disponibles para operar." />
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 px-4">
          {pallets.map((pallet) => (
            <li key={pallet.id} className="flex gap-3 py-3 text-sm">
              <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${pallet.received ? "bg-emerald-600" : "border border-slate-300 bg-white"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-slate-950">{pallet.qrCode}</p>
                <p className="text-stone-500">
                  {pallet.productName} ({pallet.productSku}) · Lote {pallet.batchNumber}
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {pallet.received ? "Recibido" : "Pendiente"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section className="surface bg-[#f9fbfb] p-4">
        <h3 className="text-xs font-bold tracking-[0.1em] text-stone-500">HISTORIAL DE ESCANEOS ({initialScanHistory.length + scanHistory.length})</h3>
        {initialScanHistory.length === 0 && scanHistory.length === 0 ? <EmptyState title="Sin escaneos registrados" description="El historial se completará al escanear o validar pallets de esta orden." /> : <ul className="mt-3 space-y-2 text-sm">{scanHistory.map((scan, index) => <li key={`session-${scan.code}-${index}`} className="flex items-center gap-2"><span className={scan.success ? "text-emerald-600" : "text-red-600"}>●</span><span className="min-w-0 break-all font-mono font-semibold">{scan.code}</span><span className="text-stone-500">{scan.message}</span></li>)}{initialScanHistory.map((scan) => <li key={scan.id} className="flex items-center gap-2"><span className="text-emerald-600">●</span><span className="min-w-0 break-all font-mono font-semibold">{scan.qrCode}</span><span className="text-stone-500">Recibido el {new Date(scan.createdAt).toLocaleString("es-AR")}</span></li>)}</ul>}
      </section>

      {isScannerOpen && (
        <QrScanner
          disabled={isPending}
          onCancel={() => setIsScannerOpen(false)}
          onScan={handleScan}
        />
      )}

      <Modal open={Boolean(pendingQrCode)} onClose={() => setPendingQrCode(null)}
        title="Confirmar recepción" busy={isPending}
        description={<>¿El pallet <strong className="break-all font-mono">{pendingQrCode}</strong> llegó conforme? Se registrará su recepción o la discrepancia elegida. Esta interfaz no permite deshacer el registro.</>}
        actions={<button type="button" className="button-secondary" disabled={isPending} onClick={() => setPendingQrCode(null)}>Cancelar</button>}>
        {submissionError && <InlineAlert variant="danger">{submissionError}</InlineAlert>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className="button-primary" disabled={isPending} aria-busy={isPending} onClick={() => confirmReception(null)}>{isPending ? "Registrando…" : "OK"}</button>
              {([
                ["surplus", "Sobrante"],
                ["damaged", "Dañado"],
              ] as const).map(([type, label]) => (
                <button key={type} type="button" className="button-secondary text-left" disabled={isPending} aria-busy={isPending} onClick={() => confirmReception(type)}>{label}</button>
              ))}
            </div>
      </Modal>
    </div>
  );
}
