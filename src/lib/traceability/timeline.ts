/**
 * TRZ-57 / TRZ-58: línea de tiempo unificada de uno o varios pallets.
 *
 * Lógica pura (sin Supabase ni React): convierte las filas de traceability_events en entradas con título,
 * detalle, quién y cuándo. La usan la línea de tiempo por pallet y, juntando varios pallets, la de lote.
 * El alta del pallet no es un evento de la base: se arma con pallets.created_at.
 */

export type TimelineTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Fila de traceability_events con el nombre de quien la registró. */
export type TimelineEventRow = {
  id: string;
  event_type: string;
  created_at: string;
  pallet_id: string | null;
  order_id: string | null;
  details: Record<string, unknown> | null;
  user_name: string | null;
};

/** Alta del pallet, para el primer evento de su recorrido. */
export type TimelinePalletOrigin = {
  palletId: string;
  qrCode: string;
  createdAt: string;
};

export type TimelineEntry = {
  id: string;
  at: string;
  eventType: string;
  title: string;
  description: string | null;
  actor: string | null;
  tone: TimelineTone;
  orderId: string | null;
  palletId: string | null;
  palletCode: string | null;
};

const DIFFERENCE_LABELS: Record<string, string> = {
  missing: "Faltante",
  surplus: "Sobrante",
  damaged: "Dañado",
  wrong_order: "No corresponde a la orden",
};

const DELIVERY_OUTCOME_LABELS: Record<string, string> = {
  delivered: "Entregado sin diferencias",
  missing: "No llegó (faltante)",
  damaged: "Llegó dañado",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function differenceLabel(details: Record<string, unknown>): string | null {
  const type = text(details.type);
  return type ? DIFFERENCE_LABELS[type] ?? type : null;
}

/** Título, detalle y tono de cada tipo de evento. Un tipo desconocido se muestra igual, con su código. */
function describe(row: TimelineEventRow): Pick<TimelineEntry, "title" | "description" | "tone"> {
  const details = row.details ?? {};
  switch (row.event_type) {
    case "order_created":
      return { title: "Orden creada", description: null, tone: "neutral" };
    case "pallet_associated":
      return { title: "Asociado a una orden", description: null, tone: "info" };
    case "pallet_dissociated":
      return { title: "Desasociado de la orden", description: null, tone: "warning" };
    case "qr_scan": {
      const round = typeof details.validation_round === "number" ? details.validation_round : null;
      return {
        title: "Escaneado en el despacho",
        description: round && round > 1 ? `Nuevo escaneo (vez ${round}) después de corregir el pallet` : null,
        tone: "info",
      };
    }
    case "dispatch_discrepancy":
      return { title: "Diferencia en el despacho", description: differenceLabel(details), tone: "danger" };
    case "dispatch_confirmed": {
      const count = typeof details.pallet_count === "number" ? details.pallet_count : null;
      return {
        title: "Despacho confirmado",
        description: count === null ? null : `${count} ${count === 1 ? "pallet" : "pallets"} en la orden`,
        tone: "success",
      };
    }
    case "location_assigned":
      return { title: "Ubicación asignada", description: text(details.new_location), tone: "neutral" };
    case "location_changed": {
      const from = text(details.previous_location) ?? "Sin ubicación";
      const to = text(details.new_location) ?? "—";
      return { title: "Ubicación cambiada", description: `${from} → ${to}`, tone: "neutral" };
    }
    case "reception":
      return { title: "Recepción registrada", description: text(details.destination_location), tone: "success" };
    case "reception_discrepancy":
      return { title: "Diferencia en la recepción", description: differenceLabel(details), tone: "danger" };
    case "delivery_confirmed": {
      const outcome = text(details.outcome) ?? "delivered";
      return {
        title: "Entrega confirmada por el chofer",
        description: DELIVERY_OUTCOME_LABELS[outcome] ?? outcome,
        tone: outcome === "delivered" ? "success" : "danger",
      };
    }
    case "delivery_discrepancy":
      return { title: "Diferencia en la entrega", description: differenceLabel(details), tone: "danger" };
    default:
      return { title: row.event_type, description: null, tone: "neutral" };
  }
}

export function toTimelineEntry(row: TimelineEventRow, palletCodes: ReadonlyMap<string, string> = new Map()): TimelineEntry {
  const details = row.details ?? {};
  return {
    id: row.id,
    at: row.created_at,
    eventType: row.event_type,
    ...describe(row),
    // Las ubicaciones guardan el nombre en el propio evento (TRZ-96).
    actor: text(row.user_name) ?? text(details.user_name),
    orderId: row.order_id,
    palletId: row.pallet_id,
    palletCode: (row.pallet_id && palletCodes.get(row.pallet_id)) ?? text(details.qr_code),
  };
}

/**
 * Arma la línea de tiempo en orden cronológico (más viejo primero). El alta de cada pallet va primero; los
 * empates de hora se ordenan por id para que el orden sea estable.
 */
export function buildTimeline(rows: TimelineEventRow[], origins: TimelinePalletOrigin[] = []): TimelineEntry[] {
  const palletCodes = new Map(origins.map((origin) => [origin.palletId, origin.qrCode]));
  const created: TimelineEntry[] = origins.map((origin) => ({
    id: `created:${origin.palletId}`,
    at: origin.createdAt,
    eventType: "pallet_created",
    title: "Pallet armado",
    description: null,
    actor: null,
    tone: "neutral",
    orderId: null,
    palletId: origin.palletId,
    palletCode: origin.qrCode,
  }));
  const seen = new Set<string>();
  const events = rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .map((row) => toTimelineEntry(row, palletCodes));

  return [...created, ...events].sort((a, b) => {
    const byTime = Date.parse(a.at) - Date.parse(b.at);
    if (byTime !== 0) return byTime;
    if (a.eventType === "pallet_created" && b.eventType !== "pallet_created") return -1;
    if (b.eventType === "pallet_created" && a.eventType !== "pallet_created") return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
