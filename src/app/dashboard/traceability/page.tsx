import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LotTraceability } from "@/components/traceability/lot-traceability";
import { PalletTraceability } from "@/components/traceability/pallet-traceability";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getLotTraceability, getPalletTraceability } from "@/lib/traceability/queries";
import { PageHeader } from "@/components/ui/design-system";

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
  return <div className="app-page"><PageHeader title={`Trazabilidad de ${title}`} description="Consultá el historial de movimientos registrado." action={<Link href={backHref} className="button-secondary">← Volver a {backLabel}</Link>} />{children}</div>;
}

function TooLongMessage() {
  return <p role="alert" className="feedback feedback-danger">El código de búsqueda no puede superar los 512 caracteres.</p>;
}

function NotFoundMessage({ entity }: { entity: string }) {
  return <p role="status" className="feedback feedback-warning">No se encontró ningún {entity} con ese código.</p>;
}
