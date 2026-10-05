"use client";

import { useId, useState } from "react";

import type { OrderNotification } from "@/lib/order-notifications/types";
import { ORDER_NOTIFICATION_LABELS } from "@/lib/order-notifications/labels";
import { Badge, EmptyState, SectionHeader } from "@/components/ui/design-system";

type OrderNotificationsPanelProps = {
  notifications: OrderNotification[];
};

const FILTERS = [
  { value: "all", label: "Todas" },
  { value: "dispatch", label: "Despacho" },
  { value: "reception", label: "Recepción" },
] as const;

type NotificationFilter = (typeof FILTERS)[number]["value"];

const TYPE_DETAILS = {
  dispatch: { label: "Despacho", tone: "warning", iconClassName: "stroke-amber-600" },
  reception: { label: "Recepción", tone: "info", iconClassName: "stroke-sky-600" },
  other: { label: "Otro evento", tone: "neutral", iconClassName: "stroke-stone-500" },
} as const;

function notificationType(eventType: string) {
  if (eventType.startsWith("dispatch_")) return "dispatch";
  if (eventType.startsWith("reception_")) return "reception";
  return "other";
}

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Unifica las discrepancias de despacho y recepción visibles por RLS. */
export function OrderNotificationsPanel({ notifications }: OrderNotificationsPanelProps) {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const titleId = useId();
  const listId = useId();
  const filteredNotifications = notifications.filter((notification) =>
    filter === "all" || notificationType(notification.eventType) === filter,
  );
  const counts = {
    all: notifications.length,
    dispatch: notifications.filter((notification) => notificationType(notification.eventType) === "dispatch").length,
    reception: notifications.filter((notification) => notificationType(notification.eventType) === "reception").length,
  };

  return (
    <section aria-labelledby={titleId} className="list-content section-stack">
      <SectionHeader
        id={titleId}
        title="Notificaciones"
        description="Discrepancias de despacho y recepción de esta orden, en un mismo lugar."
      />
      <div className="surface p-4 sm:p-6">
        <fieldset className="filter-group">
          <legend className="filter-legend">
            Tipo de discrepancia
          </legend>
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              aria-controls={listId}
              onClick={() => setFilter(option.value)}
              className={`filter-chip ${filter === option.value ? "filter-chip-active" : ""}`}
            >
              {option.label} ({counts[option.value]})
            </button>
          ))}
        </fieldset>
        <p role="status" className="mt-4 text-xs text-stone-500">
          {filteredNotifications.length} de {notifications.length} notificaciones
        </p>

        <div id={listId} className="mt-2">
          {filteredNotifications.length === 0 ? (
            <EmptyState
              title={notifications.length === 0 ? "Sin inconsistencias registradas" : "Sin resultados para este filtro"}
              description={notifications.length === 0 ? "Las discrepancias detectadas en despacho o recepción aparecerán acá." : `No hay discrepancias de ${filter === "dispatch" ? "despacho" : "recepción"} registradas para esta orden.`}
              action={notifications.length > 0 ? <button type="button" className="button-secondary" onClick={() => setFilter("all")}>Ver todas</button> : undefined}
            />
          ) : (
            <ul className="divide-y divide-stone-200">
              {filteredNotifications.map((notification) => {
                const detail = TYPE_DETAILS[notificationType(notification.eventType)];
                return (
                  <li key={notification.id} className="flex gap-3 py-4 text-sm">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className={`mt-0.5 size-5 shrink-0 fill-none ${detail.iconClassName}`} strokeWidth="2">
                      <path d="m12 3 9 17H3z" /><path d="M12 9v5M12 18h.01" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge tone={detail.tone}>{detail.label}</Badge>
                        <time dateTime={notification.createdAt} className="text-xs text-stone-500">
                          {DATE_FORMATTER.format(new Date(notification.createdAt))}
                        </time>
                      </div>
                      <p className="mt-2 font-semibold text-slate-950">
                        {ORDER_NOTIFICATION_LABELS[notification.eventType as keyof typeof ORDER_NOTIFICATION_LABELS] ?? notification.eventType}
                      </p>
                      <p className="mt-1 break-words text-stone-600">{notification.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
