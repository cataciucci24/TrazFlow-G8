"use client";

import { useState, useTransition } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await dissociatePallet(orderId, palletId);
      if (result.outcome !== "dissociated") {
        setError(result.message);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={handleClick}
        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Quitando..." : "Quitar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
