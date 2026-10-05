"use client";

import { useFeedback } from "@/components/ui/feedback";

import { useState, useTransition } from "react";

import { ConfirmationDialog } from "@/components/ui/modal";
import { dissociatePallet } from "@/lib/orders/actions";

type DissociatePalletButtonProps = {
  orderId: string;
  palletId: string;
  disabled: boolean;
};

export function DissociatePalletButton({
  orderId,
  palletId,
  disabled,
}: DissociatePalletButtonProps) {
  const notify = useFeedback();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (disabled || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await dissociatePallet(orderId, palletId);
        if (result.outcome !== "dissociated") {
          setError(result.message);
        } else {
          notify(result.message);
          setOpen(false);
        }
      } catch {
        setError("No se pudo quitar el pallet. Intentá nuevamente.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={() => { setError(null); setOpen(true); }}
        className="button-danger"
      >
        {isPending ? "Quitando..." : "Quitar"}
      </button>
      <ConfirmationDialog open={open} onClose={() => setOpen(false)} onConfirm={handleClick}
        title="Quitar pallet de la orden"
        description={<>Vas a quitar el pallet <strong className="break-all font-mono">{palletId}</strong> de la orden <strong className="break-all font-mono">{orderId}</strong>. El pallet volverá a depósito; no se elimina. Podés volver a asociarlo mientras la orden admita cambios.</>}
        confirmLabel="Quitar pallet" danger busy={isPending} blocked={disabled} error={error} />
    </div>
  );
}
