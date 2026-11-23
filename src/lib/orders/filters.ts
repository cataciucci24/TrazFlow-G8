import { ORDER_STATUS_LABELS } from "./labels";
import type { OrderStatus } from "../types";

export type OrderFilters = { status: OrderStatus | ""; distributor: string };
export type OrderSearchParams = Record<string, string | string[] | undefined>;

/** Los valores repetidos o desconocidos no se convierten en filtros de base de datos. */
export function readOrderFilters(params: OrderSearchParams): OrderFilters {
  const status = typeof params.status === "string" && Object.hasOwn(ORDER_STATUS_LABELS, params.status)
    ? params.status as OrderStatus : "";
  const distributor = typeof params.distributor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.distributor)
    ? params.distributor.toLowerCase() : "";
  return { status, distributor };
}

export function applyOrderFilters<T extends { eq: (column: string, value: string) => T }>(query: T, filters: OrderFilters): T {
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.distributor) query = query.eq("distributor_id", filters.distributor);
  return query;
}
