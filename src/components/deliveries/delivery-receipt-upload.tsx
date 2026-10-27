"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, InlineAlert } from "@/components/ui/design-system";
import { registerDeliveryReceipt } from "@/lib/deliveries/actions";
import {
  DELIVERY_RECEIPTS_BUCKET,
  DELIVERY_RECEIPTS_MAX_PER_ORDER,
  DELIVERY_RECEIPT_ACCEPT,
  FILE_PROBLEM_MESSAGES,
  deliveryReceiptFileProblem,
  deliveryReceiptPath,
  type DeliveryReceiptSummary,
} from "@/lib/deliveries/receipts";
import { createClient } from "@/lib/supabase/client";

/**
 * Remito firmado (TRZ-103). El archivo va del celular directo a Supabase Storage (el bucket ya limita tipo y
 * tamaño y la RLS solo deja escribir al chofer de la orden); después la server action lo registra y, si la orden
 * vino del ERP, queda en el outbox para adjuntarse al remito del ERP. Es opcional: la entrega se cierra igual.
 */
export function DeliveryReceiptUpload({ orderId, companyId, receipts, canAttach }: {
  orderId: string;
  companyId: string;
  receipts: DeliveryReceiptSummary[];
  canAttach: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const full = receipts.length >= DELIVERY_RECEIPTS_MAX_PER_ORDER;

  function upload(file: File) {
    const problem = deliveryReceiptFileProblem(file);
    if (problem) {
      setMessage({ ok: false, text: FILE_PROBLEM_MESSAGES[problem] });
      return;
    }
    startTransition(async () => {
      const path = deliveryReceiptPath(companyId, orderId, crypto.randomUUID(), file.type);
      const { error } = await createClient().storage.from(DELIVERY_RECEIPTS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        setMessage({ ok: false, text: "No se pudo subir el archivo. Revisá la conexión e intentá de nuevo." });
        return;
      }
      const result = await registerDeliveryReceipt(orderId, path, file.name);
      setMessage({ ok: result.outcome === "registered" || result.outcome === "already_registered", text: result.message });
      router.refresh();
    });
  }

  return <section className="surface space-y-4 p-5" aria-labelledby="delivery-receipt-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="delivery-receipt-title" className="font-semibold">Remito firmado</h2>
        <p className="text-sm text-stone-500">Opcional. Sacá una foto o subí un PDF (hasta 10 MB). Solo lo ve tu empresa.</p>
      </div>
      <button type="button" className="button-secondary" disabled={!canAttach || full || isPending}
        onClick={() => { setMessage(null); input.current?.click(); }}>
        {isPending ? "Subiendo…" : receipts.length ? "Agregar otra hoja" : "Adjuntar remito"}
      </button>
      <input ref={input} type="file" accept={DELIVERY_RECEIPT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload(file);
        }} />
    </div>

    {message && <InlineAlert variant={message.ok ? "success" : "danger"}>{message.text}</InlineAlert>}
    {full && <p className="text-sm text-stone-500">Llegaste al máximo de {DELIVERY_RECEIPTS_MAX_PER_ORDER} archivos por entrega.</p>}

    {receipts.length > 0 && <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-4">
      {receipts.map((receipt) => <li key={receipt.id} className="flex items-center gap-3 py-3">
        <Badge tone="success">{receipt.contentType === "application/pdf" ? "PDF" : "Foto"}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm">{receipt.fileName}</span>
        <span className="text-xs text-stone-500">{Math.max(1, Math.round(receipt.sizeBytes / 1024))} KB</span>
      </li>)}
    </ul>}
  </section>;
}
