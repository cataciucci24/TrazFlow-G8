"use client";

import { useState, useTransition } from "react";

import { formatSyncedAt } from "@/components/erp/erp-origin";
import { Badge, InlineAlert, type BadgeTone } from "@/components/ui/design-system";
import { useFeedback } from "@/components/ui/feedback";
import { syncErpNow } from "@/lib/erp-sync/actions";
import {
  describeErpSyncRun,
  ERP_SYNC_ENTITY_LABELS,
  ERP_SYNC_STATUS_LABELS,
  type ErpSyncActionState,
  type ErpSyncEntity,
  type ErpSyncRunSummary,
  type ErpSyncStatus,
} from "@/lib/erp-sync/types";
import { warehouseLabel, type Warehouse } from "@/lib/warehouses/types";

const INITIAL_STATE: ErpSyncActionState = { status: "idle", message: null, run: null };
const STATUS_TONES: Record<ErpSyncStatus, BadgeTone> = { running: "info", success: "success", partial: "warning", failed: "danger" };
const ALERT_VARIANTS = { success: "success", partial: "warning", failed: "danger", error: "danger" } as const;
const ENTITIES: ErpSyncEntity[] = ["warehouses", "products", "lots", "stock", "orders"];
const VISIBLE_ERRORS = 8;

/**
 * Sincronización manual con el ERP (solo logística) y resumen de la última ejecución. Si el ERP falla, la
 * pantalla sigue usable: el error se muestra acá y queda auditado en erp_sync_runs.
 */
export function ErpSyncPanel({
  lastRun,
  warehouses,
}: {
  lastRun: ErpSyncRunSummary | null;
  /** Si se pasa, muestra los depósitos de la empresa (TRZ-101: los del ERP los trae la sincronización). */
  warehouses?: Warehouse[];
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
            Depósitos, productos, lotes, saldos de stock y órdenes se importan del ERP. Lo que ya avanzó en TrazFlow no se pisa.
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

      {warehouses ? <WarehouseList warehouses={warehouses} /> : null}
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
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
                      counters.adopted ? `${counters.adopted} ya vinculados (conservan su código)` : null,
                      counters.merged ? `${counters.merged} sumados a otro depósito` : null,
                      counters.deactivated ? `${counters.deactivated} ya no vienen del ERP (inactivos)` : null,
                      counters.protected ? `${counters.protected} con progreso local (no se tocaron)` : null,
                      counters.skipped ? `${counters.skipped} cerradas en el ERP` : null,
                      counters.absent ? `${counters.absent} ya no vienen del ERP (quedan en 0)` : null,
                      counters.failed ? `${counters.failed} con error` : null,
                    ].filter(Boolean).join(" · ")
                  : "No se procesó"}
              </dd>
            </div>
          );
        })}
      </dl>
      {run.counters.dispatch_documents?.received ? (
        <p className="text-xs text-stone-600">
          {ERP_SYNC_ENTITY_LABELS.dispatch_documents}: {[
            `${run.counters.dispatch_documents.received} consultados`,
            run.counters.dispatch_documents.confirmed ? `${run.counters.dispatch_documents.confirmed} confirmados` : null,
            run.counters.dispatch_documents.draft ? `${run.counters.dispatch_documents.draft} en borrador` : null,
            run.counters.dispatch_documents.cancelled ? `${run.counters.dispatch_documents.cancelled} anulados` : null,
            run.counters.dispatch_documents.not_found ? `${run.counters.dispatch_documents.not_found} no encontrados` : null,
            run.counters.dispatch_documents.failed ? `${run.counters.dispatch_documents.failed} con error` : null,
          ].filter(Boolean).join(" · ")}.
        </p>
      ) : null}
      {run.notices.length > 0 ? (
        <details className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <summary className="cursor-pointer font-medium text-slate-950">{run.notices.length} aviso(s)</summary>
          <ul className="mt-2 space-y-1 text-xs text-stone-700">
            {run.notices.slice(0, VISIBLE_ERRORS).map((notice, index) => (
              <li key={`${notice.entity}-${notice.external_id}-${index}`} className="break-words">
                <span className="font-medium">{ERP_SYNC_ENTITY_LABELS[notice.entity] ?? notice.entity}</span>
                {notice.external_id ? <> · <span className="font-mono">{notice.external_id}</span></> : null}: {notice.message}
              </li>
            ))}
            {run.notices.length > VISIBLE_ERRORS ? <li>… y {run.notices.length - VISIBLE_ERRORS} más.</li> : null}
          </ul>
        </details>
      ) : null}
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

/** Depósitos de la empresa. Los del ERP llegan con la sincronización; no se vinculan a mano (TRZ-101). */
function WarehouseList({ warehouses }: { warehouses: Warehouse[] }) {
  return (
    <div className="space-y-2 border-t border-stone-200 pt-4 text-sm">
      <h3 className="font-medium text-slate-950">Depósitos</h3>
      <p className="text-stone-500">
        Los depósitos del ERP se importan solos al sincronizar, cada uno con su código en TrazFlow, y su stock entra en ese depósito. Si el ERP deja de informar uno, queda inactivo.
      </p>
      {warehouses.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {warehouses.map((warehouse) => (
            <li key={warehouse.code}>
              <Badge tone={warehouse.active ? undefined : "warning"}>
                {warehouseLabel(warehouse)}
                {warehouse.sourceSystem === "trazflow" ? " (TrazFlow)" : ""}
                {warehouse.active ? "" : " · inactivo"}
              </Badge>
            </li>
          ))}
        </ul>
      ) : <p className="text-stone-500">Todavía no hay depósitos: se importan en la próxima sincronización.</p>}
    </div>
  );
}
