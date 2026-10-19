import Link from "next/link";

import { totalPages } from "@/lib/erp-integration/filters";
import type { Page } from "@/lib/erp-integration/types";

/** Paginación por links (sin JS): `hrefFor(n)` arma la URL de la página n con los filtros actuales. */
export function Pagination<T>({ page, label, hrefFor }: { page: Page<T>; label: string; hrefFor: (n: number) => string }) {
  const pages = totalPages(page.total, page.pageSize);
  if (page.total <= page.pageSize && page.page === 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
      <p>Página {Math.min(page.page, pages)} de {pages} · {page.total} resultado(s)</p>
      <div className="flex gap-2">
        {page.page > 1 ? <Link href={hrefFor(Math.min(page.page - 1, pages))} className="button-secondary button-sm">Anterior</Link> : null}
        {page.page < pages ? <Link href={hrefFor(page.page + 1)} className="button-secondary button-sm">Siguiente</Link> : null}
      </div>
    </nav>
  );
}
