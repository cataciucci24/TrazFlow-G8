"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { PalletScanDetails } from "@/components/pallets/pallet-scan-details";
import { Modal } from "@/components/ui/modal";
import { Badge, EmptyState, InlineAlert, OperationProgress } from "@/components/ui/design-system";
import { ScanButton } from "@/components/ui/scan-button";
import { confirmDeliveryPallet } from "@/lib/deliveries/actions";
import type { DeliveryDiscrepancyType, DeliveryPallet, DeliveryResult } from "@/lib/deliveries/types";

export function DeliveryPanel({ orderId, pallets, canDeliver }: { orderId: string; pallets: DeliveryPallet[]; canDeliver: boolean }) {
  const router = useRouter();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const processed = pallets.filter((pallet) => pallet.deliveryOutcome !== null).length;
  const hasDiscrepancy = pallets.some((pallet) => pallet.deliveryOutcome !== null && pallet.deliveryOutcome !== "delivered");
  const expectedCode = pendingCode ? pallets.some((pallet) => pallet.qrCode === pendingCode.trim()) : false;

  const submit = useCallback((code: string, difference: DeliveryDiscrepancyType | null) => {
    startTransition(async () => {
      const response = await confirmDeliveryPallet(orderId, code, difference);
      setResult(response);
      setPendingCode(null);
      router.refresh();
    });
  }, [orderId, router]);

  return <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
      <ScanButton disabled={!canDeliver || isPending || pallets.length === 0} busy={isPending}
        onClick={() => { setResult(null); setScannerOpen(true); }}
        label="Escanear pallet en la entrega" busyLabel="Registrando…" />
      <div className="surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold tracking-[0.08em] text-stone-500">PROGRESO</p><p className="mt-1 font-mono font-bold">{orderId.slice(0, 8).toUpperCase()}</p></div>
          <Badge tone={hasDiscrepancy ? "danger" : processed === pallets.length ? "success" : "warning"}>{processed} / {pallets.length}</Badge>
        </div>
        <OperationProgress completed={processed} total={pallets.length} label="pallets procesados" />
      </div>
    </div>

    {!canDeliver && <InlineAlert>La entrega ya fue cerrada o la orden todavía no está en tránsito.</InlineAlert>}
    {result && <InlineAlert variant={["delivered", "already_processed", "surplus_recorded"].includes(result.outcome) ? "success" : "danger"}>{result.message}</InlineAlert>}
    {result?.pallet && <PalletScanDetails key={`${result.pallet.qrCode}:${result.outcome}`} qrCode={result.pallet.qrCode} />}

    {pallets.length === 0 ? <EmptyState title="Entrega sin pallets" description="No hay pallets esperados para procesar." /> :
      <ul className="operation-list">
        {pallets.map((pallet) => <li key={pallet.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <span aria-hidden="true" className={`size-3 shrink-0 rounded-full ${pallet.deliveryOutcome === "delivered" ? "bg-emerald-600" : pallet.deliveryOutcome ? "bg-red-600" : "border border-stone-300"}`} />
          <div className="min-w-0 flex-1">
            <p className="break-all font-mono font-semibold">{pallet.qrCode}</p>
            <p className="text-sm text-stone-500">{pallet.productName} · Lote {pallet.batchNumber} · {pallet.quantity ?? "—"} {pallet.unitOfMeasure}</p>
          </div>
          {pallet.deliveryOutcome ? <Badge tone={pallet.deliveryOutcome === "delivered" ? "success" : "danger"}>{pallet.deliveryOutcome === "delivered" ? "Entregado" : pallet.deliveryOutcome === "missing" ? "Faltante" : "Dañado"}</Badge>
            : <button type="button" className="button-secondary button-sm" disabled={!canDeliver || isPending} onClick={() => submit(pallet.qrCode, "missing")}>Marcar faltante</button>}
        </li>)}
      </ul>}

    {scannerOpen && <QrScanner disabled={isPending} onCancel={() => setScannerOpen(false)} onScan={(code) => { setScannerOpen(false); setPendingCode(code); }} />}
    <Modal open={Boolean(pendingCode)} onClose={() => setPendingCode(null)} title="Confirmar resultado" busy={isPending}
      description={expectedCode ? "Confirmá la entrega del pallet o registralo como dañado." : "El código no pertenece a los pallets esperados. Registrá la diferencia."}
      actions={<button type="button" className="button-secondary" onClick={() => setPendingCode(null)} disabled={isPending}>Cancelar</button>}>
      <p className="break-all font-mono text-sm font-semibold">{pendingCode}</p>
      {pendingCode && <PalletScanDetails key={pendingCode} qrCode={pendingCode.trim()} />}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {expectedCode ? <>
          <button type="button" className="button-primary" disabled={isPending} onClick={() => submit(pendingCode!, null)}>Entregado</button>
          <button type="button" className="button-secondary" disabled={isPending} onClick={() => submit(pendingCode!, "damaged")}>Dañado</button>
        </> : <>
          <button type="button" className="button-secondary" disabled={isPending} onClick={() => submit(pendingCode!, "surplus")}>Sobrante</button>
          <button type="button" className="button-secondary" disabled={isPending} onClick={() => submit(pendingCode!, "wrong_order")}>No corresponde</button>
        </>}
      </div>
    </Modal>
  </div>;
}
