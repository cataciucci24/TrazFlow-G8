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
  const detailTitle = role === "warehouse_operator" ? "Confirmar despacho" : role === "distributor_operator" ? "Confirmar recepción" : "Órdenes de despacho";

  const links = role === "logistics_manager"
    ? [
        { href: "/dashboard/orders", label: "Órdenes de despacho", icon: "☰", active: isOrders },
        { href: "/dashboard/traceability", label: "Seguimiento de pallets", icon: "◷", active: isTraceability },
      ]
    : [{ href: "/dashboard", label: detailTitle, icon: "⌘", active: pathname.startsWith("/dashboard") }];

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-white lg:min-h-screen lg:w-[284px] lg:border-r lg:border-b-0">
      <Link href="/dashboard" className="flex h-[74px] items-center gap-4 border-b border-stone-200 px-7 text-lg font-bold tracking-tight text-slate-950">
        <BrandMark className="size-8" />TrazFlow
      </Link>
      <div className="border-b border-stone-200 px-5 py-4">
        <p className="mb-2 text-xs font-bold tracking-[0.12em] text-stone-500">ROL ACTIVO</p>
        <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold ${roleDetail.tone}`}>
          <span className={`size-2.5 rounded-full ${roleDetail.color}`} />{roleDetail.label}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 py-3 lg:block lg:px-4 lg:py-4">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={`flex min-w-max items-center gap-4 rounded-l-xl border-l-2 px-4 py-3 text-base font-medium transition-colors lg:mb-1 ${link.active ? "border-amber-500 bg-amber-50 text-amber-600" : "border-transparent text-stone-600 hover:bg-stone-50"}`}>
            <span className="w-5 text-center text-lg leading-none">{link.icon}</span>{link.label}
          </Link>
        ))}
      </nav>
      <div className="hidden flex-1 lg:block" />
      <div className="border-t border-stone-200 px-5 py-4">
        <LogoutButton className="flex items-center gap-3 text-base text-stone-600 transition-colors hover:text-slate-950">
          <span aria-hidden="true">⇥</span> Cerrar sesión
        </LogoutButton>
      </div>
    </aside>
  );
}
