"use client";

import { useState, useTransition } from "react";

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
  const [result, setResult] = useState<ConfirmDispatchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const isBlocked = missingPalletsCount > 0;
  const isSuccess = result?.outcome === "confirmed";

  const handleConfirm = () => {
    setResult(null);
    startTransition(async () => {
      const confirmResult = await confirmDispatchOrder(orderId);
      setResult(confirmResult);
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
          disabled={isPending || isBlocked || isSuccess}
          onClick={handleConfirm}
          className="button-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Confirmando..." : "Confirmar despacho"}
        </button>
      </div>

      {result && (
        <div
          role={isSuccess ? "status" : "alert"}
          className={`rounded-md border px-3 py-3 text-sm ${
            isSuccess
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
