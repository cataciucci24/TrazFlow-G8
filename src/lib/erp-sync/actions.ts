"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getCompanyErpContext, isErpError, type ErpContext } from "@/lib/erp";
import { ErpSyncStartError, syncCompanyFromErp } from "@/lib/erp-sync/sync";
import { describeErpSyncRun, type ErpSyncActionState } from "@/lib/erp-sync/types";
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
  "/dashboard/locations",
];

/** Sincronización manual con el ERP. Solo logística; la RPC vuelve a verificar empresa y rol. */
export async function syncErpNow(): Promise<ErpSyncActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { status: "error", message: "Solo logística puede sincronizar con el ERP.", run: null };
  }
  let erp: ErpContext | null;
  try {
    erp = await getCompanyErpContext(profile.companyId);
  } catch (error) {
    const message = isErpError(error) && error.code === "config"
      ? `La configuración del ERP de tu empresa no es válida: ${error.message}`
      : "No se pudo leer la configuración del ERP de tu empresa. Intentá nuevamente.";
    return { status: "error", message, run: null };
  }
  if (!erp) {
    return { status: "error", message: "Tu empresa no tiene un ERP configurado. Configuralo en Integración ERP.", run: null };
  }
  const context = erp;

  const supabase = await createClient();
  try {
    const run = await syncCompanyFromErp({
      db: { rpc: (fn, args) => supabase.rpc(fn, args) },
      companyId: profile.companyId,
      actorId: profile.id,
      provider: context.provider,
      getClient: () => context.client,
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
