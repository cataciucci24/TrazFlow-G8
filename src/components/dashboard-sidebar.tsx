"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { BrandLogo } from "@/components/brand-mark";
import type { UserRole } from "@/lib/types";

type DashboardSidebarProps = { role: UserRole };

const roleDetails = {
  logistics_manager: { label: "Logística", color: "bg-[var(--brand)]", tone: "bg-[var(--brand-soft)] text-[var(--brand-hover)]" },
  warehouse_operator: { label: "Depósito", color: "bg-[var(--brand)]", tone: "bg-[var(--brand-soft)] text-[var(--brand-hover)]" },
  distributor_operator: { label: "Distribuidora", color: "bg-[var(--brand)]", tone: "bg-[var(--brand-soft)] text-[var(--brand-hover)]" },
} as const;

export function DashboardSidebar({ role }: DashboardSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roleDetail = roleDetails[role];
  const isOrders = pathname.startsWith("/dashboard/orders");
  const traceabilityShowsLots = pathname.startsWith("/dashboard/traceability") && searchParams.get("view") === "lotes";
  const isPallets = pathname.startsWith("/dashboard/pallets") || (pathname.startsWith("/dashboard/traceability") && !traceabilityShowsLots);
  const isLots = pathname.startsWith("/dashboard/lots") || traceabilityShowsLots;
  const isInventory = pathname.startsWith("/dashboard/inventory");
  const isAlerts = pathname.startsWith("/dashboard/alerts");
  const isStockReport = pathname.startsWith("/dashboard/stock-report");
  const isStagnant = pathname.startsWith("/dashboard/stagnant");
  const detailTitle = role === "warehouse_operator" ? "Confirmar despacho" : role === "distributor_operator" ? "Confirmar recepción" : "Órdenes de despacho";

  const links = role === "logistics_manager"
    ? [
        { href: "/dashboard/orders", label: "Órdenes de despacho", icon: <OrdersIcon />, active: isOrders },
        { href: "/dashboard/inventory", label: "Stock", icon: <InventoryIcon />, active: isInventory },
        { href: "/dashboard/alerts", label: "Alertas", icon: <AlertIcon />, active: isAlerts },
        { href: "/dashboard/pallets", label: "Pallets", icon: <PalletIcon />, active: isPallets },
        { href: "/dashboard/lots", label: "Lotes", icon: <LotIcon />, active: isLots },
        { href: "/dashboard/stagnant", label: "Mercadería inmovilizada", icon: <StagnantIcon />, active: isStagnant },
      ]
    : role === "distributor_operator"
      ? [
          { href: "/dashboard", label: detailTitle, icon: <ScanIcon />, active: pathname === "/dashboard" || pathname.startsWith("/dashboard/orders/") },
          { href: "/dashboard/stock-report", label: "Mi stock", icon: <InventoryIcon />, active: isStockReport },
        ]
      : [{ href: "/dashboard", label: detailTitle, icon: <ScanIcon />, active: pathname === "/dashboard" || pathname.startsWith("/dashboard/orders/") }];

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-white lg:sticky lg:top-0 lg:h-dvh lg:w-[272px] lg:border-r lg:border-b-0">
      <div className="flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-5 lg:px-6">
        <Link href="/dashboard" className="flex h-full min-h-11 items-center">
          <BrandLogo />
        </Link>
        <div className="shrink-0 lg:hidden">
          <LogoutButton className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950">
            <LogoutIcon /> Cerrar sesión
          </LogoutButton>
        </div>
      </div>
      <div className="border-b border-stone-200 px-5 py-4 lg:px-6">
        <p className="mb-2 text-[11px] font-bold tracking-[0.12em] text-slate-500">ROL ACTIVO</p>
        <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${roleDetail.tone}`}>
          <span className={`size-2.5 rounded-full ${roleDetail.color}`} />{roleDetail.label}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 py-3 lg:block lg:px-3 lg:py-5" aria-label="Navegación principal">
        {links.map((link) => (
          <Link key={link.href} href={link.href} aria-current={link.active ? "page" : undefined} className={`flex min-h-11 min-w-max items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors lg:mb-1 ${link.active ? "border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-hover)]" : "border-transparent text-stone-600 hover:bg-stone-50 hover:text-stone-900"}`}>
            <span className={`grid size-5 place-items-center ${link.active ? "text-[var(--brand)]" : "text-stone-500"}`}>{link.icon}</span>{link.label}
          </Link>
        ))}
      </nav>
      <div className="hidden flex-1 lg:block" />
      <div className="hidden border-t border-stone-200 px-5 py-4 lg:block">
        <LogoutButton className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-950">
          <LogoutIcon /> Cerrar sesión
        </LogoutButton>
      </div>
    </aside>
  );
}

function InventoryIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M4 7 12 3l8 4-8 4-8-4Z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>;
}

function OrdersIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
}

function PalletIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" /></svg>;
}

function AlertIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M12 3a6 6 0 0 0-6 6v3.5L4 16h16l-2-3.5V9a6 6 0 0 0-6-6Z" /><path d="M10 20h4" /></svg>;
}

function LotIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
}

function ScanIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>;
}

function StagnantIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="m12 4 9 16H3z" /><path d="M12 9v5M12 18h.01" /></svg>;
}

function LogoutIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></svg>;
}
