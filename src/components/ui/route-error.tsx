"use client";

import { useTransition } from "react";
import { InlineAlert } from "@/components/ui/design-system";

export function RouteError({ retry }: { retry: () => void }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="space-y-5">
      <InlineAlert variant="danger">
        <h2 className="text-base font-bold">No pudimos cargar esta pantalla</h2>
        <p className="mt-1">Intentá nuevamente. Si el problema continúa, consultá con el administrador de tu empresa.</p>
      </InlineAlert>
      <button type="button" disabled={isPending} aria-busy={isPending} onClick={() => startTransition(retry)} className="button-secondary">
        {isPending ? "Reintentando…" : "Volver a intentar"}
      </button>
    </div>
  );
}
