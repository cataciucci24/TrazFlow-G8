import Link from "next/link";

import { integrationTabHref } from "@/lib/erp-integration/filters";
import { INTEGRATION_TAB_LABELS, INTEGRATION_TABS, type IntegrationTab } from "@/lib/erp-integration/types";

/**
 * Pestañas del panel de integración (Resumen · Actividad · Configuración). Navegación por query param, como en
 * Trazabilidad: funciona sin JavaScript y la URL se puede compartir. `failed` marca la pestaña Actividad cuando hay
 * reportes fallidos, para que no pasen desapercibidos desde el resumen.
 */
export function IntegrationTabs({ active, failed = 0 }: { active: IntegrationTab; failed?: number }) {
  return (
    <nav className="flex gap-2 overflow-x-auto border-b border-stone-200" aria-label="Secciones de la integración con el ERP">
      {INTEGRATION_TABS.map((tab) => (
        <Link
          key={tab}
          href={integrationTabHref(tab)}
          aria-current={active === tab ? "page" : undefined}
          className={`flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition-colors ${active === tab ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-stone-500 hover:text-stone-800"}`}
        >
          {INTEGRATION_TAB_LABELS[tab]}
          {tab === "actividad" && failed > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              {failed}<span className="sr-only"> reportes fallidos</span>
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
