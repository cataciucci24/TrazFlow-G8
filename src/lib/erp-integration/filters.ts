import { ACTIVITY_KINDS, ACTIVITY_STATUSES, type ActivityKind, type ActivityStatus, type IntegrationFilters } from "./types.ts";

export const INTEGRATIONS_PATH = "/dashboard/integrations";
export const ACTIVITY_PAGE_SIZE = 20;
export const UNREPORTED_PAGE_SIZE = 10;
export const MAX_SEARCH_LENGTH = 100;
const MAX_PAGE = 10_000;
/** Argentina no usa horario de verano: el día operativo empieza a las 00:00 -03:00. */
const DAY_OFFSET = "-03:00";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

export const EMPTY_FILTERS: IntegrationFilters = {
  kind: null, status: null, from: null, to: null, search: null, page: 1, unreportedPage: 1, event: null,
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function isKind(value: string): value is ActivityKind {
  return ACTIVITY_KINDS.some((kind) => kind === value);
}

function isStatus(value: string): value is ActivityStatus {
  return ACTIVITY_STATUSES.some((status) => status === value);
}

/** `YYYY-MM-DD` que además es una fecha real (descarta 2026-02-30). */
export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function parsePage(value: string): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/**
 * Lee los filtros de la URL. Lo inválido se descarta (sin romper la página) y se informa en `problems`.
 */
export function parseIntegrationFilters(params: SearchParams): { filters: IntegrationFilters; problems: string[] } {
  const problems: string[] = [];
  const filters: IntegrationFilters = { ...EMPTY_FILTERS };

  const kind = first(params.kind);
  if (kind) {
    if (isKind(kind)) filters.kind = kind;
    else problems.push("El tipo de evento no es válido; se muestran todos.");
  }

  const status = first(params.status);
  if (status) {
    if (isStatus(status)) filters.status = status;
    else problems.push("El estado no es válido; se muestran todos.");
  }

  const from = first(params.from);
  if (from) {
    if (isValidDay(from)) filters.from = from;
    else problems.push("La fecha desde no es válida.");
  }
  const to = first(params.to);
  if (to) {
    if (isValidDay(to)) filters.to = to;
    else problems.push("La fecha hasta no es válida.");
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    problems.push("La fecha desde es posterior a la fecha hasta; se ignoró el rango.");
    filters.from = null;
    filters.to = null;
  }

  const search = first(params.q);
  if (search) {
    if (search.length > MAX_SEARCH_LENGTH) problems.push(`La búsqueda se recortó a ${MAX_SEARCH_LENGTH} caracteres.`);
    filters.search = search.slice(0, MAX_SEARCH_LENGTH);
  }

  filters.page = parsePage(first(params.page));
  filters.unreportedPage = parsePage(first(params.upage));

  const event = first(params.event);
  if (event) {
    const separator = event.indexOf(":");
    const eventKind = event.slice(0, separator);
    const eventId = event.slice(separator + 1);
    if (separator > 0 && isKind(eventKind) && UUID.test(eventId)) filters.event = { kind: eventKind, id: eventId.toLowerCase() };
    else problems.push("El evento pedido no es válido.");
  }

  return { filters, problems };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Argumentos de erp_integration_activity. El rango es por día de Argentina; `to` se vuelve exclusivo. */
export function toActivityRpcArgs(filters: IntegrationFilters, pageSize = ACTIVITY_PAGE_SIZE) {
  return {
    p_kind: filters.kind,
    p_status: filters.status,
    p_from: filters.from ? `${filters.from}T00:00:00${DAY_OFFSET}` : null,
    p_to: filters.to ? `${nextDay(filters.to)}T00:00:00${DAY_OFFSET}` : null,
    p_search: filters.search,
    p_limit: pageSize,
    p_offset: (filters.page - 1) * pageSize,
  };
}

/** URL del panel con los filtros actuales y los cambios pedidos. Omite los valores por defecto. */
export function buildIntegrationsHref(filters: IntegrationFilters, changes: Partial<IntegrationFilters> = {}): string {
  const next = { ...filters, ...changes };
  const query = new URLSearchParams();
  if (next.kind) query.set("kind", next.kind);
  if (next.status) query.set("status", next.status);
  if (next.from) query.set("from", next.from);
  if (next.to) query.set("to", next.to);
  if (next.search) query.set("q", next.search);
  if (next.page > 1) query.set("page", String(next.page));
  if (next.unreportedPage > 1) query.set("upage", String(next.unreportedPage));
  if (next.event) query.set("event", `${next.event.kind}:${next.event.id}`);
  const search = query.toString();
  return search ? `${INTEGRATIONS_PATH}?${search}` : INTEGRATIONS_PATH;
}

export function hasActivityFilters(filters: IntegrationFilters): boolean {
  return Boolean(filters.kind || filters.status || filters.from || filters.to || filters.search);
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
