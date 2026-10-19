"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { Modal } from "@/components/ui/modal";
import { Badge, EmptyState, InlineAlert } from "@/components/ui/design-system";
import { confirmDeliveryPallet } from "@/lib/deliveries/actions";
import type { DeliveryDiscrepancyType, DeliveryPallet, DeliveryResult } from "@/lib/deliveries/types";

export function DeliveryPanel({ orderId, pallets, canDeliver }: { orderId: string; pallets: DeliveryPallet[]; canDeliver: boolean }) {
  const router = useRouter();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const processed = pallets.filter((pallet) => pallet.deliveryOutcome !== null).length;
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
      <button type="button" className="scanner-trigger group" disabled={!canDeliver || isPending || pallets.length === 0}
        onClick={() => { setResult(null); setScannerOpen(true); }}>
        <svg viewBox="0 0 24 24" className="mb-4 size-11 stroke-stone-500" fill="none" strokeWidth="1.5"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>
        <span className="text-base">{isPending ? "Registrando…" : "Escanear pallet en la entrega"}</span>
        <span className="mt-2 text-xs text-stone-500">Se abrirá la cámara del dispositivo</span>
      </button>
      <div className="surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold tracking-[0.08em] text-stone-500">PROGRESO</p><p className="mt-1 font-mono font-bold">{orderId.slice(0, 8).toUpperCase()}</p></div>
          <Badge tone={processed === pallets.length ? "success" : "warning"}>{processed} / {pallets.length}</Badge>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${pallets.length ? (processed / pallets.length) * 100 : 0}%` }} /></div>
      </div>
    </div>

    {!canDeliver && <InlineAlert>La entrega ya fue cerrada o la orden todavía no está en tránsito.</InlineAlert>}
    {result && <InlineAlert variant={["delivered", "already_processed", "surplus_recorded"].includes(result.outcome) ? "success" : "danger"}>{result.message}</InlineAlert>}

    {pallets.length === 0 ? <EmptyState title="Entrega sin pallets" description="No hay pallets esperados para procesar." /> :
      <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-4">
        {pallets.map((pallet) => <li key={pallet.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <span className={`size-3 shrink-0 rounded-full ${pallet.deliveryOutcome ? "bg-emerald-600" : "border border-stone-300"}`} />
          <div className="min-w-0 flex-1">
            <p className="break-all font-mono font-semibold">{pallet.qrCode}</p>
            <p className="text-sm text-stone-500">{pallet.productName} · Lote {pallet.batchNumber} · {pallet.quantity ?? "—"} {pallet.unitOfMeasure}</p>
          </div>
          {pallet.deliveryOutcome ? <Badge tone={pallet.deliveryOutcome === "delivered" ? "success" : "danger"}>{pallet.deliveryOutcome === "delivered" ? "Entregado" : pallet.deliveryOutcome === "missing" ? "Faltante" : "Dañado"}</Badge>
            : <button type="button" className="button-secondary button-sm" disabled={!canDeliver || isPending} onClick={() => submit(pallet.qrCode, "missing")}>Marcar faltante</button>}
        </li>)}
      </ul>}

    {scannerOpen && <QrScanner disabled={isPending} onCancel={() => setScannerOpen(false)} onScan={(code) => { setScannerOpen(false); setPendingCode(code); }} />}
    <Modal open={Boolean(pendingCode)} onClose={() => setPendingCode(null)} title="Confirmar resultado"
      description={expectedCode ? "Confirmá la entrega del pallet o registralo como dañado." : "El código no pertenece a los pallets esperados. Registrá la diferencia."}
      actions={<button type="button" className="button-secondary" onClick={() => setPendingCode(null)} disabled={isPending}>Cancelar</button>}>
      <p className="break-all font-mono text-sm font-semibold">{pendingCode}</p>
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
