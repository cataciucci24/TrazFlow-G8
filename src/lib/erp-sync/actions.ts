"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getErpClient } from "@/lib/erp";
import { configuredErpProvider, isErpEnabled } from "@/lib/erp-sync/enabled";
import { ErpSyncStartError, syncCompanyFromErp } from "@/lib/erp-sync/sync";
import { describeErpSyncRun, type ErpSyncActionState, type LinkErpWarehouseState } from "@/lib/erp-sync/types";
import { createClient } from "@/lib/supabase/server";

const SYNCED_PATHS = [
  "/dashboard",
  "/dashboard/orders",
  "/dashboard/pallets",
  "/dashboard/lots",
  "/dashboard/inventory",
  "/dashboard/traceability",
  "/dashboard/alerts",
  "/dashboard/integrations",
];

/** Sincronización manual con el ERP. Solo logística; la RPC vuelve a verificar empresa y rol. */
export async function syncErpNow(): Promise<ErpSyncActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { status: "error", message: "Solo logística puede sincronizar con el ERP.", run: null };
  }
  if (!(await isErpEnabled(profile.companyId))) {
    return {
      status: "error",
      message: "La integración con el ERP no está configurada para esta instalación (falta ERP_PROVIDER en el servidor).",
      run: null,
    };
  }

  const supabase = await createClient();
  try {
    const run = await syncCompanyFromErp({
      db: { rpc: (fn, args) => supabase.rpc(fn, args) },
      companyId: profile.companyId,
      actorId: profile.id,
      provider: configuredErpProvider(),
      getClient: () => getErpClient(profile.companyId),
    });
    for (const path of SYNCED_PATHS) revalidatePath(path);
    return { status: run.status === "running" ? "error" : run.status, message: describeErpSyncRun(run), run };
  } catch (error) {
    const message = error instanceof ErpSyncStartError
      ? error.message
      : "No se pudo completar la sincronización con el ERP. Intentá nuevamente.";
    return { status: "error", message, run: null };
  }
}

/** Vincula un depósito del ERP (su nombre/id tal cual) con el depósito de TrazFlow. */
export async function linkErpWarehouse(
  _previousState: LinkErpWarehouseState,
  formData: FormData,
): Promise<LinkErpWarehouseState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede vincular depósitos del ERP.", success: null };
  }
  const externalWarehouseId = String(formData.get("externalWarehouseId") ?? "").trim();
  if (!externalWarehouseId || externalWarehouseId.length > 300) {
    return { error: "Ingresá el depósito tal como figura en el ERP (hasta 300 caracteres).", success: null };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("erp_warehouse_mappings")
    .insert({ company_id: profile.companyId, external_warehouse_id: externalWarehouseId });
  if (error) {
    return {
      error: error.code === "23505" ? "Ese depósito del ERP ya está vinculado." : "No se pudo vincular el depósito. Intentá nuevamente.",
      success: null,
    };
  }

  revalidatePath("/dashboard/pallets");
  return { error: null, success: `Depósito "${externalWarehouseId}" vinculado a DEP-01. Volvé a sincronizar para importar sus saldos.` };
}
