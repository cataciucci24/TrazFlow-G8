"use client";

import { useRef, useState, useTransition } from "react";

import { formatSyncedAt } from "@/components/erp/erp-origin";
import { Badge, InlineAlert, type BadgeTone } from "@/components/ui/design-system";
import { useFeedback } from "@/components/ui/feedback";
import { linkErpWarehouse, syncErpNow } from "@/lib/erp-sync/actions";
import {
  describeErpSyncRun,
  ERP_SYNC_ENTITY_LABELS,
  ERP_SYNC_STATUS_LABELS,
  type ErpSyncActionState,
  type ErpSyncEntity,
  type ErpSyncRunSummary,
  type ErpSyncStatus,
  type LinkErpWarehouseState,
} from "@/lib/erp-sync/types";

const INITIAL_STATE: ErpSyncActionState = { status: "idle", message: null, run: null };
const STATUS_TONES: Record<ErpSyncStatus, BadgeTone> = { running: "info", success: "success", partial: "warning", failed: "danger" };
const ALERT_VARIANTS = { success: "success", partial: "warning", failed: "danger", error: "danger" } as const;
const ENTITIES: ErpSyncEntity[] = ["products", "lots", "stock", "orders"];
const VISIBLE_ERRORS = 8;

/**
 * Sincronización manual con el ERP (solo logística) y resumen de la última ejecución. Si el ERP falla, la
 * pantalla sigue usable: el error se muestra acá y queda auditado en erp_sync_runs.
 */
export function ErpSyncPanel({
  lastRun,
  warehouseMappings,
}: {
  lastRun: ErpSyncRunSummary | null;
  /** Si se pasa, muestra los depósitos del ERP vinculados y el formulario para vincular otro. */
  warehouseMappings?: string[];
}) {
  const notify = useFeedback();
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const run = state.run ?? lastRun;

  function handleSync() {
    if (isPending) return;
    startTransition(async () => {
      try {
        const next = await syncErpNow();
        setState(next);
        if (next.status === "success" && next.message) notify(next.message);
      } catch {
        setState({ status: "error", message: "No se pudo completar la sincronización con el ERP. Intentá nuevamente.", run: null });
      }
    });
  }

  return (
    <section className="surface space-y-4 p-4 sm:p-5" aria-labelledby="erp-sync-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="erp-sync-title" className="text-base font-semibold text-slate-950">Integración ERP</h2>
          <p className="text-sm text-stone-500">
            Productos, lotes, saldos de stock y órdenes se importan del ERP. Lo que ya avanzó en TrazFlow no se pisa.
          </p>
        </div>
        <button type="button" onClick={handleSync} disabled={isPending} aria-busy={isPending} className="button-primary">
          {isPending ? "Sincronizando…" : "Sincronizar con ERP"}
        </button>
      </div>

      {state.status !== "idle" && state.message ? (
        <InlineAlert variant={ALERT_VARIANTS[state.status]}>{state.message}</InlineAlert>
      ) : null}

      {run ? <LastRun run={run} /> : <p className="text-sm text-stone-500">Todavía no se sincronizó con el ERP.</p>}

      {warehouseMappings ? <WarehouseMappings mappings={warehouseMappings} /> : null}
    </section>
  );
}

function LastRun({ run }: { run: ErpSyncRunSummary }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-stone-600">
        <span>Última sincronización: {formatSyncedAt(run.finishedAt ?? run.startedAt)}</span>
        <Badge tone={STATUS_TONES[run.status]}>{ERP_SYNC_STATUS_LABELS[run.status]}</Badge>
        <span className="text-xs text-stone-500">Proveedor: {run.provider}</span>
      </p>
      {run.status !== "success" ? <p className="text-stone-600">{describeErpSyncRun(run)}</p> : null}
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ENTITIES.map((entity) => {
          const counters = run.counters[entity];
          return (
            <div key={entity} className="rounded-lg border border-stone-200 p-3">
              <dt className="font-medium text-slate-950">{ERP_SYNC_ENTITY_LABELS[entity]}</dt>
              <dd className="mt-1 text-xs text-stone-600">
                {counters
                  ? [
                      `${counters.created ?? 0} nuevos`,
                      `${counters.updated ?? 0} actualizados`,
                      `${counters.unchanged ?? 0} sin cambios`,
                      counters.protected ? `${counters.protected} con progreso local (no se tocaron)` : null,
                      counters.skipped ? `${counters.skipped} cerradas en el ERP` : null,
                      counters.absent ? `${counters.absent} sin saldo en el ERP (se conservan)` : null,
                      counters.failed ? `${counters.failed} con error` : null,
                    ].filter(Boolean).join(" · ")
                  : "No se procesó"}
              </dd>
            </div>
          );
        })}
      </dl>
      {run.errors.length > 0 ? (
        <details className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <summary className="cursor-pointer font-medium text-amber-900">
            {run.errors.length} registro(s) con error
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-amber-950">
            {run.errors.slice(0, VISIBLE_ERRORS).map((error, index) => (
              <li key={`${error.entity}-${error.external_id}-${index}`} className="break-words">
                <span className="font-medium">{ERP_SYNC_ENTITY_LABELS[error.entity] ?? error.entity}</span>
                {error.external_id ? <> · <span className="font-mono">{error.external_id}</span></> : null}: {error.message}
              </li>
            ))}
            {run.errors.length > VISIBLE_ERRORS ? <li>… y {run.errors.length - VISIBLE_ERRORS} más.</li> : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function WarehouseMappings({ mappings }: { mappings: string[] }) {
  const notify = useFeedback();
  const [state, setState] = useState<LinkErpWarehouseState>({ error: null, success: null });
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    startTransition(async () => {
      try {
        const next = await linkErpWarehouse(state, new FormData(form));
        setState(next);
        if (next.success) { notify(next.success); formRef.current?.reset(); }
      } catch {
        setState({ error: "No se pudo vincular el depósito. Intentá nuevamente.", success: null });
      }
    });
  }

  return (
    <div className="space-y-2 border-t border-stone-200 pt-4 text-sm">
      <h3 className="font-medium text-slate-950">Depósitos del ERP vinculados a DEP-01</h3>
      <p className="text-stone-500">
        Cada saldo del ERP se importa como pallet en el depósito vinculado. Un saldo de un depósito sin vincular no se importa y queda como error.
      </p>
      {mappings.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {mappings.map((name) => <li key={name}><Badge>{name}</Badge></li>)}
        </ul>
      ) : <p className="text-stone-500">Ningún depósito vinculado todavía.</p>}
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2" aria-busy={isPending}>
        <label className="form-label min-w-0 flex-1">
          Depósito en el ERP
          <input name="externalWarehouseId" required maxLength={300} placeholder="Ej. Depósito Central - SRV" className="form-control mt-1.5 font-normal" />
        </label>
        <button disabled={isPending} aria-busy={isPending} className="button-secondary">{isPending ? "Vinculando…" : "Vincular"}</button>
      </form>
      {state.error ? <InlineAlert variant="danger">{state.error}</InlineAlert> : null}
    </div>
  );
}
