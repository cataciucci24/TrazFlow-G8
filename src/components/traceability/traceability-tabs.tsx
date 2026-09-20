import Link from "next/link";

/** Navegación por query param, consistente con el resto de la búsqueda GET de esta página. */
export function TraceabilityTabs({ active }: { active: "pallets" | "lotes" }) {
  return (
    <nav className="flex gap-2 border-b border-stone-200" aria-label="Ver seguimiento por pallet o por lote">
      <Tab href="/dashboard/traceability" active={active === "pallets"}>Pallets</Tab>
      <Tab href="/dashboard/traceability?view=lotes" active={active === "lotes"}>Lotes</Tab>
    </nav>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`border-b-2 px-4 py-3 text-sm font-bold transition-colors ${active ? "border-amber-500 text-amber-600" : "border-transparent text-stone-500 hover:text-stone-700"}`}
    >
      {children}
    </Link>
  );
}
