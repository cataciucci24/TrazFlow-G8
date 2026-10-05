"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useState, useTransition } from "react";

import { ConfirmationDialog } from "@/components/ui/modal";
import { confirmDispatchOrder } from "@/lib/orders/actions";
import type { ConfirmDispatchResult } from "@/lib/orders/actions";

type ConfirmDispatchButtonProps = {
  orderId: string;
  missingPalletsCount: number;
};

export function ConfirmDispatchButton({
  orderId,
  missingPalletsCount,
}: ConfirmDispatchButtonProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ConfirmDispatchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const isBlocked = missingPalletsCount > 0;
  const isSuccess = result?.outcome === "confirmed";

  const handleConfirm = () => {
    if (isPending || isBlocked || isSuccess) return;
    setResult(null);
    startTransition(async () => {
      try {
        const confirmResult = await confirmDispatchOrder(orderId);
        setResult(confirmResult);
        if (confirmResult.outcome === "confirmed") setOpen(false);
      } catch {
        setResult({ outcome: "error", message: "No se pudo confirmar el despacho. Intentá nuevamente." });
      }
    });
  };

  return (
    <div className="surface space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">
            Confirmar despacho
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {isBlocked
              ? `Faltan validar ${missingPalletsCount} pallet(s) para poder confirmar.`
              : "La carga fue validada. Confirmá para dar por salida la mercadería."}
          </p>
        </div>

        <button
          type="button"
          disabled={isPending || isBlocked || isSuccess} aria-busy={isPending}
          onClick={() => { setResult(null); setOpen(true); }}
          className="button-primary"
        >
          {isPending ? "Confirmando..." : "Confirmar despacho"}
        </button>
      </div>

      <ConfirmationDialog open={open} onClose={() => setOpen(false)} onConfirm={handleConfirm}
        title="Confirmar despacho"
        description={<>Vas a confirmar la salida de la orden <strong className="break-all font-mono">{orderId}</strong>. La mercadería quedará en tránsito. Esta interfaz no permite deshacer el despacho.</>}
        confirmLabel="Confirmar despacho" busy={isPending} blocked={isBlocked || isSuccess}
        error={result && !isSuccess ? result.message : null} />
      {result && !open && (
        <InlineAlert variant={isSuccess ? "success" : "danger"}>{result.message}</InlineAlert>
      )}
    </div>
  );
}
