import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ErpSyncPanel } from "@/components/erp/erp-sync-panel";
import { NewPalletForm } from "@/components/pallets/new-pallet-form";
import { PalletTrackingPanel } from "@/components/traceability/pallet-tracking-panel";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getErpWarehouseMappings, getLatestErpSyncRun } from "@/lib/erp-sync/queries";
import { getCompanyLots, getCompanyPallets, getCompanyProducts } from "@/lib/pallets/queries";
import type { ProductBatch } from "@/lib/types";
import { InlineAlert, PageHeader } from "@/components/ui/design-system";

export const metadata: Metadata = { title: "Pallets | TrazFlow" };

export default async function PalletsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const erpEnabled = await isErpEnabled(profile.companyId);
  const [pallets, lots, products, lastRun, mappings] = await Promise.all([
    getCompanyPallets(profile.companyId),
    getCompanyLots(),
    getCompanyProducts(profile.companyId),
    erpEnabled ? getLatestErpSyncRun(profile.companyId) : null,
    erpEnabled ? getErpWarehouseMappings(profile.companyId) : [],
  ]);
  const existingBatches: ProductBatch[] = lots.map((lot) => ({ productSku: lot.productSku, batchNumber: lot.batchNumber }));

  // Con ERP, el alta manual (NewPalletForm) se reemplaza por la sincronización; sin ERP, todo sigue como antes.
  return <div className="app-page">
    <PageHeader title="Pallets"
      description={erpEnabled ? "Consultá y seguí los pallets. Los saldos de stock llegan desde el ERP." : "Consultá, registrá y realizá el seguimiento de tus pallets."}
      action={erpEnabled ? undefined : <NewPalletForm existingBatches={existingBatches} existingProducts={products} />} />
    {erpEnabled ? <>
      <ErpSyncPanel lastRun={lastRun} warehouseMappings={mappings.map((mapping) => mapping.externalWarehouseId)} />
      <InlineAlert variant="info" announce={false}>
        Un pallet importado del ERP representa un saldo de stock (lote × depósito), no un pallet físico verificado. Imprimí su etiqueta QR cuando se prepare físicamente.
      </InlineAlert>
    </> : null}
    <PalletTrackingPanel pallets={pallets} existingBatches={existingBatches} existingProducts={products} erpManaged={erpEnabled} />
  </div>;
}
