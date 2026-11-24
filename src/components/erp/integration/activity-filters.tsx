import Link from "next/link";

import { describeActivityFilters, integrationTabHref, INTEGRATIONS_PATH, MAX_SEARCH_LENGTH } from "@/lib/erp-integration/filters";
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  type IntegrationFilters,
} from "@/lib/erp-integration/types";

/** Tag con los filtros activos; la cruz los quita y vuelve a la actividad completa. */
export function ActiveFiltersTag({ filters }: { filters: IntegrationFilters }) {
  return (
    <Link href={integrationTabHref("actividad")}
      className="inline-flex min-h-9 items-center gap-2 rounded-full border border-stone-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-stone-500">
      {describeActivityFilters(filters).join(" · ")}
      <span aria-hidden="true" className="text-base leading-none text-stone-500">×</span>
      <span className="sr-only">Quitar filtros</span>
    </Link>
  );
}

/** Filtros por GET: quedan en la URL, se pueden compartir y funcionan sin JavaScript. Solo sin filtros activos. */
export function ActivityFilters({ filters }: { filters: IntegrationFilters }) {
  return (
    <form method="get" action={INTEGRATIONS_PATH} className="filter-panel" aria-label="Filtros de actividad">
      <input type="hidden" name="tab" value="actividad" />
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
      <div className="mobile-button-group mt-3 flex flex-wrap gap-2">
        <button type="submit" className="button-primary">Aplicar filtros</button>
      </div>
    </form>
  );
}
