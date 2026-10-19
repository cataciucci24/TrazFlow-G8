import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PalletLabelSheet } from "@/components/pallets/pallet-label-sheet";
import { EmptyState, PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { parsePalletSelection } from "@/lib/pallet-labels/selection";
import { getCompanyPalletsByIds } from "@/lib/pallets/queries";

export const metadata: Metadata = { title: "Imprimir etiquetas | TrazFlow" };

export default async function PrintPalletLabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const { ids: rawIds } = await searchParams;
  const ids = parsePalletSelection(rawIds);
  const pallets = ids.length ? await getCompanyPalletsByIds(profile.companyId, ids) : [];
  return <div className="print-root app-page">
    <div className="no-print"><PageHeader title="Imprimir etiquetas" description="El QR y el código legible usan exactamente el identificador persistido del pallet." action={<Link href="/dashboard/pallets" className="button-secondary">Volver</Link>} /></div>
    {pallets.length === 0 ? <div className="no-print surface"><EmptyState title="No hay etiquetas válidas" description="Seleccioná pallets de tu empresa desde el listado." /></div> : <PalletLabelSheet pallets={pallets} />}
  </div>;
}
