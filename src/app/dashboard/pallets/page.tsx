import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ErpSyncPanel } from "@/components/erp/erp-sync-panel";
import { NewPalletForm } from "@/components/pallets/new-pallet-form";
import { PalletTrackingPanel } from "@/components/traceability/pallet-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getErpStockOverview } from "@/lib/erp-stock/queries";
import { getLatestErpSyncRun } from "@/lib/erp-sync/queries";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import type { ProductBatch } from "@/lib/types";
import { getWarehouses } from "@/lib/warehouses/queries";
import { InlineAlert, PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Pallets | TrazFlow" };

export default async function PalletsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const erpEnabled = await isErpEnabled(profile.companyId);
  const [pallets, lots, products, lastRun, warehouses, erpLots] = await Promise.all([
    getCompanyPallets(profile.companyId),
    getCompanyLots(),
    getCompanyProducts(profile.companyId),
    erpEnabled ? getLatestErpSyncRun(profile.companyId) : null,
    getWarehouses(profile.companyId),
    erpEnabled ? getErpStockOverview() : undefined,
  ]);
  const existingBatches: ProductBatch[] = lots.map((lot) => ({ productSku: lot.productSku, batchNumber: lot.batchNumber }));

  // Con ERP (TRZ-100), los pallets físicos se arman contra el saldo de un lote del ERP; sin ERP, todo sigue como antes.
  return <div className="app-page">
    <PageHeader title="Pallets"
      description={erpEnabled ? "Armá los pallets físicos contra los lotes del ERP y seguí su estado." : "Consultá, registrá y realizá el seguimiento de tus pallets."}
      action={<NewPalletForm existingBatches={existingBatches} existingProducts={products} erpLots={erpLots} warehouses={warehouses} />} />
    {erpEnabled ? <>
      <ErpSyncPanel lastRun={lastRun} warehouses={warehouses} />
      <InlineAlert variant="info" announce={false}>
        El ERP informa cuánto hay de cada lote; los pallets los armás acá con su cantidad real, sin superar ese saldo. Los marcados &quot;Heredado de saldo ERP&quot; son de antes y no se editan.
      </InlineAlert>
    </> : null}
    <PalletTrackingPanel pallets={pallets} existingBatches={existingBatches} existingProducts={products} erpManaged={erpEnabled} />
  </div>;
}
