import Link from "next/link";

import { formatSyncedAt } from "@/components/erp/erp-origin";
import { RetryEventButton } from "@/components/erp/integration/integration-buttons";
import { IntegrationBadgeView } from "@/components/erp/integration/integration-badge";
import { activityBadge } from "@/lib/erp-integration/status";
import { ACTIVITY_STATUS_LABELS, type IntegrationEventDetail } from "@/lib/erp-integration/types";
import { ERP_SYNC_ENTITY_LABELS, type ErpSyncEntity } from "@/lib/erp-sync/types";

/** Explicación para logística de cada código de error del contrato (docs/erp-contract.md §6). */
const ERROR_HELP: Record<string, string> = {
  timeout: "El ERP no respondió a tiempo. Se reintenta solo; si persiste, revisá que el ERP esté disponible.",
  network: "No se pudo conectar con el ERP. Se reintenta solo.",
  unavailable: "El ERP tuvo un error interno. Se reintenta solo.",
  rate_limited: "El ERP pidió bajar la frecuencia de llamadas. Se reintenta solo.",
  unauthorized: "El ERP rechazó las credenciales. Hay que revisar la configuración del servidor antes de reintentar.",
  validation: "El ERP rechazó los datos (orden cerrada, lote de otro producto…). Corregilo en el ERP y reintentá.",
  not_found: "El ERP no encontró la entidad referida. Revisala en el ERP y reintentá.",
  conflict: "El ERP ya tiene un despacho con esta clave y otro contenido. Requiere revisión manual en el ERP.",
  invalid_response: "La respuesta del ERP no respeta el contrato. Avisá al equipo técnico.",
  config: "La integración está mal configurada en el servidor. Avisá al equipo técnico.",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-stone-500">{label}</dt><dd className="font-medium text-slate-950">{children}</dd></div>;
}

export function EventDetail({ detail, closeHref }: { detail: IntegrationEventDetail; closeHref: string }) {
  return (
    <section id="detalle" className="surface space-y-4 p-4 sm:p-5" aria-labelledby="event-detail-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="event-detail-title" className="text-base font-semibold text-slate-950">
            {detail.kind === "sync" ? "Detalle de la sincronización" : `Reporte de despacho ${detail.order.externalId ?? ""}`}
          </h2>
          <IntegrationBadgeView badge={activityBadge(detail.kind, detail.status)} detail={ACTIVITY_STATUS_LABELS[detail.status]} />
        </div>
        <Link href={closeHref} scroll={false} className="button-ghost">Cerrar detalle</Link>
      </div>
      {detail.kind === "sync" ? <SyncDetail detail={detail} /> : <OutboxDetail detail={detail} />}
    </section>
  );
}

function SyncDetail({ detail }: { detail: Extract<IntegrationEventDetail, { kind: "sync" }> }) {
  return (
    <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Inicio">{formatSyncedAt(detail.startedAt)}</Field>
        <Field label="Fin">{detail.finishedAt ? formatSyncedAt(detail.finishedAt) : "En curso"}</Field>
        <Field label="Proveedor">{detail.provider}</Field>
        <Field label="Iniciada por">{detail.triggeredByName ?? "—"}</Field>
      </dl>
      {detail.errorMessage ? <p className="text-sm text-red-700">{detail.errorMessage}</p> : null}
      {detail.errors.length > 0 ? (
        <div className="space-y-2 text-sm">
          <h3 className="font-medium text-slate-950">{detail.errors.length} registro(s) con error</h3>
          <ul className="space-y-1 text-stone-700">
            {detail.errors.map((error, index) => (
              <li key={`${error.entity}-${error.external_id}-${index}`} className="break-words">
                <span className="font-medium">{ERP_SYNC_ENTITY_LABELS[error.entity as ErpSyncEntity] ?? error.entity}</span>
                {error.external_id ? <> · <span className="font-mono">{error.external_id}</span></> : null}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function OutboxDetail({ detail }: { detail: Extract<IntegrationEventDetail, { kind: "dispatch_confirmed" }> }) {
  return (
    <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Orden">
          <Link href={`/dashboard/orders/${detail.order.id}`} className="underline">{detail.order.externalId ?? "Ver orden"}</Link>
        </Field>
        <Field label="Creado">{formatSyncedAt(detail.createdAt)}</Field>
        <Field label="Intentos">{detail.attempts}</Field>
        <Field label={detail.status === "sent" ? "Enviado" : "Próximo intento"}>
          {detail.status === "sent" && detail.sentAt
            ? formatSyncedAt(detail.sentAt)
            : detail.status === "pending" && detail.nextAttemptAt ? formatSyncedAt(detail.nextAttemptAt) : "—"}
        </Field>
        {detail.erpReference ? <Field label="Referencia en el ERP">{detail.erpReference}{detail.erpDuplicate ? " (ya registrado)" : ""}</Field> : null}
        {detail.lastAttemptAt ? <Field label="Último intento">{formatSyncedAt(detail.lastAttemptAt)}</Field> : null}
      </dl>

      {detail.errorMessage || detail.errorCode ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p><span className="font-mono">[{detail.errorCode ?? "error"}]</span> {detail.errorMessage}</p>
          {detail.errorCode && ERROR_HELP[detail.errorCode] ? <p className="mt-1">{ERROR_HELP[detail.errorCode]}</p> : null}
        </div>
      ) : null}

      {detail.status === "failed" ? <RetryEventButton eventId={detail.id} /> : null}

      <div className="space-y-2 text-sm">
        <h3 className="font-medium text-slate-950">Pallets informados ({detail.lines.length})</h3>
        <ul className="space-y-1 text-stone-700">
          {detail.lines.map((line, index) => (
            <li key={`${line.palletCode}-${index}`} className="break-words">
              <span className="font-mono">{line.palletCode ?? "—"}</span> · lote <span className="font-mono">{line.lotExternalId ?? "sin lote del ERP"}</span>
              {" · "}{line.quantity ?? "—"} {line.uom ?? ""}
            </li>
          ))}
        </ul>
      </div>

      {detail.retries.length > 0 ? (
        <div className="space-y-2 text-sm">
          <h3 className="font-medium text-slate-950">Reintentos manuales</h3>
          <ul className="space-y-1 text-stone-700">
            {detail.retries.map((retry) => (
              <li key={retry.requestedAt}>
                {formatSyncedAt(retry.requestedAt)} · {retry.requestedByName ?? "—"} · tenía {retry.previousAttempts} intento(s)
                {retry.previousErrorCode ? <> · <span className="font-mono">{retry.previousErrorCode}</span></> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
