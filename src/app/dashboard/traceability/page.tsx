import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LotTraceability } from "@/components/traceability/lot-traceability";
import { PalletTraceability } from "@/components/traceability/pallet-traceability";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getLotTraceability, getPalletTraceability } from "@/lib/traceability/queries";

export const metadata: Metadata = { title: "Trazabilidad | TrazFlow" };

type TraceabilitySearchParams = { qr?: string; status?: string; view?: string; lote?: string };

export default async function TraceabilityPage({ searchParams }: { searchParams: Promise<TraceabilitySearchParams> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");

  const params = await searchParams;
  const isLots = params.view === "lotes";
  const query = isLots ? params.lote?.trim() : params.qr?.trim();
  if (!query) {
    const status = !isLots && params.status ? `?status=${encodeURIComponent(params.status)}` : "";
    redirect(isLots ? "/dashboard/lots" : `/dashboard/pallets${status}`);
  }

  const isTooLong = query.length > 512;
  if (isLots) {
    const lots = isTooLong ? null : await getLotTraceability(query);
    return <TraceabilityLayout backHref="/dashboard/lots" backLabel="Lotes" title="lote">{isTooLong ? <TooLongMessage /> : !lots || lots.length === 0 ? <NotFoundMessage entity="lote" /> : <LotTraceability lots={lots} />}</TraceabilityLayout>;
  }

  const pallet = isTooLong ? null : await getPalletTraceability(query, profile.companyId);
  return <TraceabilityLayout backHref="/dashboard/pallets" backLabel="Pallets" title="pallet">{isTooLong ? <TooLongMessage /> : !pallet ? <NotFoundMessage entity="pallet" /> : <PalletTraceability traceability={pallet} />}</TraceabilityLayout>;
}

function TraceabilityLayout({ backHref, backLabel, title, children }: { backHref: string; backLabel: string; title: string; children: React.ReactNode }) {
  return <div className="space-y-8"><div className="border-b border-stone-200 pb-6"><h1 className="text-2xl font-bold tracking-tight">Trazabilidad de {title}</h1><p className="mt-1 text-sm text-stone-500">Consultá el historial de movimientos registrado.</p></div><Link href={backHref} className="inline-flex text-sm font-bold text-amber-600 hover:text-amber-700">← Volver a {backLabel}</Link>{children}</div>;
}

function TooLongMessage() {
  return <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">El código de búsqueda no puede superar los 512 caracteres.</p>;
}

function NotFoundMessage({ entity }: { entity: string }) {
  return <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">No se encontró ningún {entity} con ese código.</p>;
}
