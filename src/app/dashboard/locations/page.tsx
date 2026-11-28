import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { getLocations, getLocationPallets } from "@/lib/locations/queries";
import { getWarehouses, getWarehouseLayouts } from "@/lib/warehouses/queries";
import { LocationsPanel } from "@/components/locations/locations-panel";
import { PageHeader } from "@/components/ui/design-system";
export const metadata = { title: "Ubicaciones | TrazFlow" };
export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ pallet?: string }> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) redirect("/dashboard");
  const params = await searchParams;
  const [locations, pallets, warehouses, layouts] = await Promise.all([getLocations(), getLocationPallets(), getWarehouses(profile.companyId), getWarehouseLayouts(profile.companyId)]);
  const locationIds = Object.fromEntries(pallets.map((p) => [p.id, p.currentLocationId ?? null]));
  return <div className="app-page"><PageHeader title="Ubicaciones" description="Identificá las posiciones de cada depósito y registrá los movimientos físicos de pallets." action={profile.role === "logistics_manager" ? <Link href="/dashboard/warehouses" className="button-secondary">Administrar depósitos</Link> : undefined} /><LocationsPanel locations={locations} pallets={pallets} warehouses={warehouses} layouts={layouts} locationIds={locationIds} initialPalletId={pallets.some((p) => p.id === params.pallet) ? params.pallet : ""} canMove={profile.role === "warehouse_operator"} canGenerate={profile.role === "logistics_manager"} /></div>;
}
