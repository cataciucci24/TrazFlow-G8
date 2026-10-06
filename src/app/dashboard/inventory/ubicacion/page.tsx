import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { locationLabel, locationOf, LocationStockTable } from "@/components/inventory/location-stock";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyPallets } from "@/lib/pallets/queries";
import { EmptyState, PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = {
  title: "Stock por ubicación | TrazFlow",
};

/** Detalle de stock de una ubicación. Sin `nombre` muestra los pallets sin ubicación registrada. */
export default async function LocationStockPage({ searchParams }: { searchParams: Promise<{ nombre?: string | string[] }> }) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const { nombre } = await searchParams;
  const location = (Array.isArray(nombre) ? nombre[0] : nombre)?.trim() || null;
  const label = locationLabel(location);
  const pallets = (await getCompanyPallets(profile.companyId)).filter((pallet) => locationOf(pallet) === location);
  const back = <Link href="/dashboard/inventory" className="button-secondary">Volver</Link>;

  return (
    <div className="app-page">
      <PageHeader
        title={label}
        description={pallets.length === 0 ? "Stock de la ubicación." : `${pallets.length} ${pallets.length === 1 ? "pallet" : "pallets"} en esta ubicación.`}
        action={back}
      />
      {pallets.length === 0 ? (
        <div className="surface">
          <EmptyState title="Sin pallets en esta ubicación" description="Puede que los pallets se hayan movido o que la ubicación ya no exista." action={back} />
        </div>
      ) : (
        <LocationStockTable location={location} pallets={pallets} />
      )}
    </div>
  );
}
