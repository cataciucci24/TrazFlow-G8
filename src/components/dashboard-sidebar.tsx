"use client";

import { useEffect, useRef, useState } from "react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const roleDetail = roleDetails[role];

  // Also close on browser history / query-string navigation and desktop resize.
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname, searchParams]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) dialogRef.current?.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);

  const closeMenu = () => dialogRef.current?.close();
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

  const navigation = (
    <nav className="px-3 py-5" aria-label="Navegación principal">
      <p className="mb-3 px-3 text-[11px] font-bold tracking-[0.12em] text-[var(--muted)]">NAVEGACIÓN</p>
      <ul className="space-y-1.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} onNavigate={closeMenu} aria-current={link.active ? "page" : undefined}
              className={`relative flex min-h-12 items-center gap-3 rounded-xl border px-3 py-3 text-sm leading-5 transition-colors ${link.active ? "border-[var(--brand-border)] bg-[var(--brand-soft)] font-bold text-[var(--brand-hover)] shadow-[var(--shadow)] before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-[var(--brand)]" : "border-transparent font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-950"}`}>
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${link.active ? "bg-white text-[var(--brand)]" : "text-stone-500"}`}>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  const account = (
    <div className="mt-auto shrink-0 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-5 py-5">
      <p className="mb-3 text-[11px] font-bold tracking-[0.12em] text-[var(--muted)]">TU SESIÓN</p>
      <div className="mb-4 flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${roleDetail.tone}`}><ScanIcon /></span>
        <div>
          <p className="text-sm font-semibold text-stone-900">{roleDetail.label}</p>
          <p className="text-xs text-[var(--muted)]">Rol activo</p>
        </div>
      </div>
      <LogoutButton className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-950">
        <LogoutIcon /> Cerrar sesión
      </LogoutButton>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 lg:hidden">
        <Link href="/dashboard" aria-label="TrazFlow, inicio" className="rounded-lg"><BrandLogo /></Link>
        <button type="button" aria-expanded={menuOpen} aria-controls="dashboard-mobile-menu" aria-haspopup="dialog"
          className="button-secondary gap-2"
          onClick={() => { dialogRef.current?.showModal(); setMenuOpen(true); }}>
          <MenuIcon /> Menú
        </button>
      </header>
      <aside className="sticky top-0 hidden h-dvh w-[288px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] lg:flex">
        <div className="flex h-[76px] shrink-0 items-center border-b border-[var(--border)] px-6">
          <Link href="/dashboard" aria-label="TrazFlow, inicio" className="rounded-lg"><BrandLogo /></Link>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {navigation}
          {account}
        </div>
      </aside>
      <dialog ref={dialogRef} id="dashboard-mobile-menu" aria-labelledby="dashboard-menu-title" aria-modal="true"
        onClose={() => setMenuOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-[min(320px,calc(100%-2rem))] max-w-none overflow-hidden border-0 bg-[var(--surface)] p-0 text-stone-950 shadow-xl backdrop:bg-stone-950/40">
        <div className="flex h-full flex-col">
          <div className="flex min-h-[76px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5">
            <Link href="/dashboard" onNavigate={closeMenu} aria-label="TrazFlow, inicio" className="rounded-lg"><BrandLogo /></Link>
            <button type="button" autoFocus onClick={closeMenu} aria-label="Cerrar menú" className="grid size-11 shrink-0 place-items-center rounded-xl text-stone-600 hover:bg-stone-100 hover:text-stone-950">
              <CloseIcon />
            </button>
          </div>
          <h2 id="dashboard-menu-title" className="sr-only">Menú de navegación de TrazFlow</h2>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {navigation}
            {account}
          </div>
        </div>
      </dialog>
    </>
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

function MenuIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
