"use client";

import { useState, useTransition } from "react";

import { InlineAlert, PageHeader } from "@/components/ui/design-system";
import { useFeedback } from "@/components/ui/feedback";
import { processErpOutboxNow, retryErpOutboxEvent } from "@/lib/erp-integration/actions";
import { syncErpNow } from "@/lib/erp-sync/actions";
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

const SYNC_ALERT = { success: "success", partial: "warning", failed: "error", error: "error" } as const;

/**
 * Encabezado del panel (TRZ-112): título, descripción y las acciones "Sincronizar ahora" y "Enviar pendientes
 * ahora". El resultado de la última acción va debajo del encabezado, de lado a lado y arriba de las pestañas, para
 * que nunca mueva ni comprima el título. El detalle queda en las tarjetas (la acción refresca la página) y en
 * Actividad.
 */
export function IntegrationPageHeader({ title, description }: { title: string; description: string }) {
  const sync = useIntegrationAction(async () => {
    const result = await syncErpNow();
    return { status: result.status === "idle" ? "error" : SYNC_ALERT[result.status], message: result.message };
  }, "No se pudo completar la sincronización con el ERP. Intentá nuevamente.");
  const pending = useIntegrationAction(
    () => processErpOutboxNow(),
    "No se pudieron enviar los reportes pendientes. Intentá nuevamente.",
  );
  const [last, setLast] = useState<"sync" | "pending" | null>(null);
  const busy = sync.isPending || pending.isPending;
  const state = last === "sync" ? sync.state : last === "pending" ? pending.state : IDLE;

  return (
    <>
      <PageHeader title={title} description={description} action={
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-primary" disabled={busy} aria-busy={sync.isPending}
            onClick={() => { setLast("sync"); sync.trigger(); }}>
            {sync.isPending ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          <button type="button" className="button-secondary" disabled={busy} aria-busy={pending.isPending}
            onClick={() => { setLast("pending"); pending.trigger(); }}>
            {pending.isPending ? "Enviando…" : "Enviar pendientes ahora"}
          </button>
        </div>
      } />
      <Result state={state} />
    </>
  );
}
