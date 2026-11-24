"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getErpClient } from "@/lib/erp";
import { describeSaveError, getErpConfigView, testErpConfig } from "@/lib/erp-integration/company-config";
import { parseErpConfigForm } from "@/lib/erp-integration/config-form";
import { describeProcessing, describeRetry, processDueErpEvents, retryFailedErpEvent } from "@/lib/erp-integration/outbox";
import type { ErpConfigActionState, IntegrationActionState } from "@/lib/erp-integration/types";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN: IntegrationActionState = { status: "error", message: "Solo logística puede operar la integración con el ERP." };

/** Páginas que muestran el estado de los reportes al ERP. */
function revalidateIntegrationPages() {
  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/[id]", "page");
  revalidatePath("/dashboard");
}

/**
 * Reintenta un reporte de despacho fallido y, si hay ERP configurado, lo envía en el momento (fuera de la
 * transacción del reintento, con timeout). La RPC vuelve a verificar rol, empresa y estado.
 */
export async function retryErpOutboxEvent(eventId: string): Promise<IntegrationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return FORBIDDEN;
  if (typeof eventId !== "string" || !UUID.test(eventId)) {
    return { status: "error", message: "El reporte indicado no es válido." };
  }

  const enabled = await isErpEnabled(profile.companyId);
  const supabase = await createClient();
  const result = await retryFailedErpEvent({
    db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
    eventId,
    companyId: profile.companyId,
    getClient: enabled ? (companyId) => getErpClient(companyId) : null,
  });
  if (result.outcome === "requeued") revalidateIntegrationPages();
  return describeRetry(result);
}

/** Envía ya los reportes pendientes cuyo backoff venció (hasta PANEL_PROCESS_LIMIT por clic). */
export async function processErpOutboxNow(): Promise<IntegrationActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return FORBIDDEN;
  if (!(await isErpEnabled(profile.companyId))) {
    return { status: "error", message: "Tu empresa no tiene un ERP configurado. Configuralo en esta misma página." };
  }

  const supabase = await createClient();
  const result = await processDueErpEvents({
    db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
    companyId: profile.companyId,
    getClient: (companyId) => getErpClient(companyId),
  });
  if ("error" in result) return { status: "error", message: result.error };
  revalidateIntegrationPages();
  return describeProcessing(result, "No hay reportes pendientes para enviar ahora (los que esperan su próximo reintento se envían cuando vence).");
}

/* ---------- TRZ-112: configuración del ERP de la empresa ---------- */

/**
 * Prueba la conexión con lo que está en el formulario, sin guardar. Las credenciales vacías usan las guardadas
 * solo si no cambiaron el proveedor ni la URL. Nunca devuelve credenciales: solo proveedor y latencia, o el error
 * saneado.
 */
export async function testErpConnection(formData: FormData): Promise<ErpConfigActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return FORBIDDEN;
  const view = await getErpConfigView(profile.companyId);
  const parsed = parseErpConfigForm(formData, { allowMock: view.allowMock });
  if (!parsed.ok) return { status: "error", message: "Revisá los datos del formulario.", errors: parsed.errors };
  if (!parsed.input.provider) return { status: "warning", message: "Elegí un ERP para probar la conexión." };

  const health = await testErpConfig({ companyId: profile.companyId, input: parsed.input, view });
  return health.status === "ok"
    ? { status: "success", message: `Conexión correcta con el ERP (${health.provider}, ${health.latencyMs} ms). Todavía no se guardó.` }
    : { status: "error", message: `No se pudo conectar: ${health.message}` };
}

/** Guarda la configuración del ERP de la empresa. La base vuelve a verificar rol y empresa, y cifra las credenciales. */
export async function saveErpConfig(formData: FormData): Promise<ErpConfigActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return FORBIDDEN;
  const view = await getErpConfigView(profile.companyId);
  const parsed = parseErpConfigForm(formData, { allowMock: view.allowMock || view.provider === "mock" });
  if (!parsed.ok) return { status: "error", message: "Revisá los datos del formulario.", errors: parsed.errors };
  const input = parsed.input;

  const supabase = await createClient();
  const { error } = await supabase.rpc("erp_save_company_config", {
    p_provider: input.provider,
    p_base_url: input.baseUrl,
    p_odoo_database: input.odooDatabase,
    p_odoo_username: input.odooUsername,
    p_item_group: input.itemGroup,
    p_timeout_ms: input.timeoutMs,
    p_mock_scenario: input.mockScenario,
    p_mock_dispatch_status: input.mockDispatchStatus,
    p_api_key: input.apiKey,
    p_api_secret: input.apiSecret,
  });
  if (error) return { status: "error", message: describeSaveError(error) };

  // Con o sin ERP cambian varias pantallas (alta manual de productos, lotes, órdenes y pallets).
  revalidatePath("/dashboard", "layout");
  return {
    status: "success",
    message: input.provider
      ? "Configuración del ERP guardada. Las credenciales quedaron cifradas."
      : "La empresa quedó sin ERP: productos, lotes y órdenes se cargan en TrazFlow.",
  };
}
