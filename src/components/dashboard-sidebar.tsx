"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { BrandMark } from "@/components/brand-mark";
import type { UserRole } from "@/lib/types";

type DashboardSidebarProps = { role: UserRole };

const roleDetails = {
  logistics_manager: { label: "Logística", color: "bg-blue-600", tone: "bg-blue-50 text-blue-600" },
  warehouse_operator: { label: "Depósito", color: "bg-amber-500", tone: "bg-amber-50 text-amber-600" },
  distributor_operator: { label: "Distribuidora", color: "bg-emerald-600", tone: "bg-emerald-50 text-emerald-600" },
} as const;

export function DashboardSidebar({ role }: DashboardSidebarProps) {
  const pathname = usePathname();
  const roleDetail = roleDetails[role];
  const isOrders = pathname.startsWith("/dashboard/orders");
  const isTraceability = pathname.startsWith("/dashboard/traceability");
  const isInventory = pathname.startsWith("/dashboard/inventory");
  const detailTitle = role === "warehouse_operator" ? "Confirmar despacho" : role === "distributor_operator" ? "Confirmar recepción" : "Órdenes de despacho";

  const links = role === "logistics_manager"
    ? [
        { href: "/dashboard/orders", label: "Órdenes de despacho", icon: <OrdersIcon />, active: isOrders },
        { href: "/dashboard/inventory", label: "Stock", icon: <InventoryIcon />, active: isInventory },
        { href: "/dashboard/traceability", label: "Seguimiento de pallets", icon: <PalletIcon />, active: isTraceability },
      ]
    : [{ href: "/dashboard", label: detailTitle, icon: <ScanIcon />, active: pathname === "/dashboard" || pathname.startsWith("/dashboard/orders/") }];

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-[284px] lg:border-r lg:border-b-0">
      <div className="flex h-[74px] shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-5 lg:px-7">
        <Link href="/dashboard" className="flex h-full items-center gap-2 text-lg font-bold tracking-tight text-slate-950 lg:gap-4">
          <BrandMark className="size-8" />TrazFlow
        </Link>
        <div className="shrink-0 lg:hidden">
          <LogoutButton className="flex items-center gap-2 text-sm text-stone-600 transition-colors hover:text-slate-950">
            <span aria-hidden="true">⇥</span> Cerrar sesión
          </LogoutButton>
        </div>
      </div>
      <div className="border-b border-stone-200 px-5 py-4">
        <p className="mb-2 text-xs font-bold tracking-[0.12em] text-stone-500">ROL ACTIVO</p>
        <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold ${roleDetail.tone}`}>
          <span className={`size-2.5 rounded-full ${roleDetail.color}`} />{roleDetail.label}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 py-3 lg:block lg:px-4 lg:py-4">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={`flex min-w-max items-center gap-4 rounded-l-xl border-l-2 px-4 py-3 text-base font-medium transition-colors lg:mb-1 ${link.active ? "border-amber-500 bg-amber-50 text-amber-600" : "border-transparent text-stone-600 hover:bg-stone-50"}`}>
            <span className="grid size-5 place-items-center text-amber-600">{link.icon}</span>{link.label}
          </Link>
        ))}
      </nav>
      <div className="hidden flex-1 lg:block" />
      <div className="hidden border-t border-stone-200 px-5 py-4 lg:block">
        <LogoutButton className="flex items-center gap-3 text-base text-stone-600 transition-colors hover:text-slate-950">
          <span aria-hidden="true">⇥</span> Cerrar sesión
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

function ScanIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>;
}
