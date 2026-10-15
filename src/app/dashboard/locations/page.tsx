import { redirect } from "next/navigation";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { getCompanyPallets } from "@/lib/pallets/queries";
import { getLocations } from "@/lib/locations/queries";
import { LocationsPanel } from "@/components/locations/locations-panel";
import { PageHeader } from "@/components/ui/design-system";
export const metadata = { title: "Ubicaciones | TrazFlow" };
export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ pallet?: string }> }) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "warehouse_operator", "logistics_manager")) redirect("/dashboard");
  const params = await searchParams;
  const [locations, pallets] = await Promise.all([getLocations(), getCompanyPallets(profile.companyId)]);
  const locationIds = Object.fromEntries(pallets.map((p) => [p.id, p.currentLocationId ?? null]));
  return <div className="app-page"><PageHeader title="Ubicaciones" description="Identificá las posiciones del depósito y registrá los movimientos físicos de pallets." /><LocationsPanel locations={locations} pallets={pallets} locationIds={locationIds} initialPalletId={pallets.some((p) => p.id === params.pallet) ? params.pallet : ""} canMove={profile.role === "warehouse_operator"} /></div>;
}
