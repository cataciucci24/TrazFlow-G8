"use client";

import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/types";

export function DashboardHeader({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const title = pathname.startsWith("/dashboard/traceability")
    ? "Seguimiento de pallets"
    : pathname.includes("/orders/")
      ? role === "distributor_operator" ? "Confirmar recepción" : "Confirmar despacho"
      : pathname.startsWith("/dashboard/orders")
        ? "Órdenes de despacho"
        : "Panel de control";
  return <header className="flex h-[74px] items-center border-b border-stone-200 bg-white px-6 text-lg font-bold lg:px-10">{title}</header>;
}
