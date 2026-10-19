import Link from "next/link";

import { INTEGRATIONS_PATH, MAX_SEARCH_LENGTH } from "@/lib/erp-integration/filters";
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  type IntegrationFilters,
} from "@/lib/erp-integration/types";

/** Filtros por GET: quedan en la URL, se pueden compartir y funcionan sin JavaScript. */
export function ActivityFilters({ filters, active }: { filters: IntegrationFilters; active: boolean }) {
  return (
    <form method="get" action={INTEGRATIONS_PATH} className="filter-panel" aria-label="Filtros de actividad">
      <div className="filter-grid">
        <label className="form-label">Estado
          <select name="status" defaultValue={filters.status ?? ""} className="form-control mt-2">
            <option value="">Todos los estados</option>
            {ACTIVITY_STATUSES.map((status) => <option key={status} value={status}>{ACTIVITY_STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="form-label">Tipo de evento
          <select name="kind" defaultValue={filters.kind ?? ""} className="form-control mt-2">
            <option value="">Todos los tipos</option>
            {ACTIVITY_KINDS.map((kind) => <option key={kind} value={kind}>{ACTIVITY_KIND_LABELS[kind]}</option>)}
          </select>
        </label>
        <label className="form-label">Desde
          <input type="date" name="from" defaultValue={filters.from ?? ""} className="form-control mt-2" />
        </label>
        <label className="form-label">Hasta
          <input type="date" name="to" defaultValue={filters.to ?? ""} className="form-control mt-2" />
        </label>
        <label className="form-label">Orden o pallet externo
          <input type="search" name="q" defaultValue={filters.search ?? ""} maxLength={MAX_SEARCH_LENGTH}
            placeholder="SAL-ORD-…, PAL-…, stock:…, lote" className="form-control mt-2" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className="button-primary">Aplicar filtros</button>
        {active ? <Link href={INTEGRATIONS_PATH} className="button-ghost">Limpiar filtros</Link> : null}
      </div>
    </form>
  );
}
