"use client";

import { useState, useTransition } from "react";

import { InlineAlert } from "@/components/ui/design-system";
import { useFeedback } from "@/components/ui/feedback";
import { processErpOutboxNow, retryErpOutboxEvent } from "@/lib/erp-integration/actions";
import type { IntegrationActionState } from "@/lib/erp-integration/types";

const IDLE: IntegrationActionState = { status: "idle", message: null };
const ALERT = { success: "success", warning: "warning", error: "danger" } as const;

function useIntegrationAction(run: () => Promise<IntegrationActionState>, failure: string) {
  const notify = useFeedback();
  const [state, setState] = useState(IDLE);
  const [isPending, startTransition] = useTransition();
  function trigger() {
    if (isPending) return;
    startTransition(async () => {
      try {
        const next = await run();
        setState(next);
        if (next.status === "success" && next.message) notify(next.message);
      } catch {
        setState({ status: "error", message: failure });
      }
    });
  }
  return { state, isPending, trigger };
}

function Result({ state }: { state: IntegrationActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return <InlineAlert variant={ALERT[state.status]} className="text-sm">{state.message}</InlineAlert>;
}

/** Reintento de un reporte fallido: vuelve a pendiente, lo audita y lo envía en el momento. */
export function RetryEventButton({ eventId }: { eventId: string }) {
  const { state, isPending, trigger } = useIntegrationAction(
    () => retryErpOutboxEvent(eventId),
    "No se pudo reintentar el reporte. Intentá nuevamente.",
  );
  return (
    <div className="space-y-2">
      <button type="button" onClick={trigger} disabled={isPending} aria-busy={isPending} className="button-primary">
        {isPending ? "Reintentando…" : "Reintentar envío"}
      </button>
      <Result state={state} />
    </div>
  );
}

/** Envía ya los reportes pendientes cuyo próximo intento venció. */
export function ProcessPendingButton() {
  const { state, isPending, trigger } = useIntegrationAction(
    () => processErpOutboxNow(),
    "No se pudieron enviar los reportes pendientes. Intentá nuevamente.",
  );
  return (
    <div className="space-y-2">
      <button type="button" onClick={trigger} disabled={isPending} aria-busy={isPending} className="button-secondary">
        {isPending ? "Enviando…" : "Enviar pendientes ahora"}
      </button>
      <Result state={state} />
    </div>
  );
}
