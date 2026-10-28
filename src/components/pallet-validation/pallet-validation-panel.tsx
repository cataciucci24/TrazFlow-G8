"use client";

import { Badge, EmptyState, InlineAlert, OperationProgress } from "@/components/ui/design-system";
import { ScanButton } from "@/components/ui/scan-button";

import { useCallback, useRef, useState, useTransition } from "react";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { validatePallet } from "@/lib/pallet-validation/actions";
import { latestScans } from "@/lib/pallet-validation/scan-history";
import type {
  OrderDispatchDiscrepancy,
  OrderPalletValidation,
  PalletValidationResult,
} from "@/lib/pallet-validation/types";
import type { ScanHistoryItem } from "@/lib/scans/queries";

type PalletValidationPanelProps = {
  orderId: string;
  pallets: OrderPalletValidation[];
  dispatchDiscrepancies: OrderDispatchDiscrepancy[];
  initialScanHistory: ScanHistoryItem[];
};

export function PalletValidationPanel({
  orderId,
  pallets,
  dispatchDiscrepancies,
  initialScanHistory,
}: PalletValidationPanelProps) {
  const scanLocked = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<PalletValidationResult | null>(null);
  const [scanHistory, setScanHistory] = useState<{ code: string; message: string; success: boolean }[]>([]);

  const [incorrectPallets, setIncorrectPallets] = useState<string[]>(
    Array.from(
      new Set(
        dispatchDiscrepancies
          .filter((discrepancy) => discrepancy.type === "wrong_order")
          .map((discrepancy) => discrepancy.qrCode),
      ),
    ),
  );

  const [isPending, startTransition] = useTransition();

  const validatedCount = pallets.filter((pallet) => pallet.validatedAt).length;
  const missingPallets = pallets.filter((pallet) => !pallet.validatedAt);
  const history = latestScans(scanHistory, initialScanHistory, new Set(missingPallets.map((pallet) => pallet.qrCode)));

  const handleScan = useCallback(
    (qrCode: string) => {
      if (scanLocked.current) return;
      scanLocked.current = true;
      setSubmissionError(null);
      setResult(null);
      startTransition(async () => {
        try {
          const validationResult = await validatePallet(orderId, qrCode);

          setResult(validationResult);
          setScanHistory((current) => [{
            code: qrCode,
            message: validationResult.message,
            success: validationResult.outcome === "validated" || validationResult.outcome === "already_validated",
          }, ...current]);

          if (validationResult.outcome === "wrong_order") {
            setIncorrectPallets((current) =>
              current.includes(qrCode) ? current : [...current, qrCode],
            );
          }

          if (validationResult.outcome === "validated" || validationResult.outcome === "already_validated") setManualCode("");
        } catch {
          setSubmissionError("No se pudo validar el pallet. Revisá tu conexión e intentá nuevamente.");
        } finally {
          scanLocked.current = false;
          setIsScannerOpen(false);
        }
      });
    },
    [orderId],
  );

  const isSuccess = result?.outcome === "validated";
  const isDuplicate = result?.outcome === "already_validated";

  const handleManualSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = manualCode.trim();
    if (!code || isPending) return;
    handleScan(code);
  };

  return (
    <div className="list-content space-y-5">
      <div className="grid gap-8 lg:grid-cols-[350px_minmax(0,1fr)]">
        <div className="space-y-3">
          <ScanButton
          disabled={isPending || pallets.length === 0} busy={isPending}
          onClick={() => {
            setResult(null);
            setIsScannerOpen(true);
          }}
          accessibleLabel="Abrir cámara para escanear QR"
          label="Tocá para escanear el QR" busyLabel="Validando…"
          />
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <label className="sr-only" htmlFor="manual-pallet-code">Código del pallet</label>
            <input id="manual-pallet-code" name="qrCode" value={manualCode} onChange={(event) => setManualCode(event.target.value)} disabled={isPending || pallets.length === 0} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" placeholder="PAL-XXXX" className="form-control min-w-0 flex-1 font-mono" />
            <button type="submit" disabled={isPending || !manualCode.trim() || pallets.length === 0} aria-busy={isPending} className="button-primary">{isPending ? "Validando…" : "Validar"}</button>
          </form>
        </div>
        <div className="surface p-5">
          <h2 className="text-sm font-bold tracking-[0.08em] text-stone-500">ESTADO DE LA ORDEN</h2>
          <div className="mt-4 flex items-center justify-between"><p className="font-mono font-bold">{orderId.slice(0, 8).toUpperCase()}</p><Badge tone={missingPallets.length === 0 ? "success" : "warning"}>{missingPallets.length === 0 ? "COMPLETA" : `${missingPallets.length} PENDIENTES`}</Badge></div>
          <OperationProgress completed={validatedCount} total={pallets.length} label="pallets confirmados" />
        </div>
      </div>

      {submissionError && <InlineAlert variant="danger">{submissionError}</InlineAlert>}
      {result && (
        <InlineAlert variant={isSuccess ? "success" : isDuplicate ? "warning" : "danger"}>
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

      {pallets.length > 0 && missingPallets.length === 0 && incorrectPallets.length === 0 && (
        <InlineAlert variant="success" announce={false}>
          <p className="font-medium text-green-800">
            Carga sin inconsistencias
          </p>
          <p className="mt-1 text-sm text-green-700">
            Todos los pallets asociados a la orden fueron validados correctamente.
          </p>
        </InlineAlert>
      )}

      {incorrectPallets.length > 0 && (
        <InlineAlert variant="warning" announce={false}>
          <p className="font-medium text-amber-900">
            Inconsistencias detectadas
          </p>
          <p className="mt-3 text-sm font-medium text-amber-900">
            Pallets incorrectos:
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
            {incorrectPallets.map((qrCode) => (
              <li key={qrCode}>{qrCode}</li>
            ))}
          </ul>
        </InlineAlert>
      )}

      {pallets.length === 0 ? (
        <EmptyState title="Orden sin pallets" description="Los pallets asociados a esta orden aparecerán acá cuando estén disponibles para operar." />
      ) : (
        <ul className="operation-list">
          {pallets.map((pallet) => (
            <li key={pallet.id} className="flex gap-3 py-3 text-sm">
              <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${pallet.validatedAt ? "bg-emerald-600" : "border border-slate-300 bg-white"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-slate-950">{pallet.qrCode}</p>
                <p className="text-stone-500">
                  {pallet.productName} ({pallet.productSku}) · Lote {pallet.batchNumber}
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {pallet.validatedAt ? "Validado" : "Pendiente"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section className="surface bg-[#f9fbfb] p-4">
        {/* Un renglón por código: el escaneo más reciente (scan-history.ts). */}
        <h3 className="text-xs font-bold tracking-[0.1em] text-stone-500">HISTORIAL DE ESCANEOS ({history.length})</h3>
        {history.length === 0 ? <EmptyState title="Sin escaneos registrados" description="El historial se completará al escanear o validar pallets de esta orden." /> : <ul className="mt-3 space-y-2 text-sm">{history.map((scan) => <li key={scan.key} className="flex items-center gap-2"><span className={scan.tone === "success" ? "text-emerald-600" : scan.tone === "warning" ? "text-amber-600" : "text-red-600"}>●</span><span className="min-w-0 break-all font-mono font-semibold">{scan.code}</span><span className="text-stone-500">{scan.message}</span></li>)}</ul>}
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
