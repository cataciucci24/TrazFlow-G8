import "server-only";

import { readCompanyErpConnection } from "@/lib/erp";
import { usesEnvErp } from "@/lib/erp/company";
import { parseCompanyErpConnection, type CompanyErpConnection } from "@/lib/erp/config";
import { createErpClient } from "@/lib/erp/factory";
import { checkErpHealth } from "@/lib/erp-integration/health";
import { comparableBaseUrl, type ErpConfigFormInput } from "@/lib/erp-integration/config-form";
import { ERP_CONFIG_PROVIDERS, type ErpConfigProvider, type ErpConfigView, type ErpHealthState } from "@/lib/erp-integration/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Configuración del ERP de la empresa desde el panel (TRZ-112). Lecturas con la sesión (RLS de
 * erp_company_settings: solo columnas sin secretos) y escritura con erp_save_company_config, que vuelve a
 * verificar rol y empresa. Las credenciales solo se leen con service_role para "Probar conexión".
 */

const VIEW_COLUMNS = [
  "erp_provider", "erp_base_url", "erp_odoo_database", "erp_odoo_username", "erp_item_group", "erp_timeout_ms",
  "erp_mock_scenario", "erp_mock_dispatch_status", "erp_api_key_hint", "erp_api_secret_hint", "erp_configured_at",
].join(", ");

type SettingsRow = {
  erp_provider: string | null;
  erp_base_url: string | null;
  erp_odoo_database: string | null;
  erp_odoo_username: string | null;
  erp_item_group: string | null;
  erp_timeout_ms: number | null;
  erp_mock_scenario: string | null;
  erp_mock_dispatch_status: string | null;
  erp_api_key_hint: string | null;
  erp_api_secret_hint: string | null;
  erp_configured_at: string | null;
};

/** El ERP simulado se ofrece solo fuera de producción (Vercel define VERCEL_ENV=production). */
export function allowMockErp(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}

function asProvider(value: string | null): ErpConfigProvider {
  return value && (ERP_CONFIG_PROVIDERS as readonly string[]).includes(value) ? value as ErpConfigProvider : "none";
}

/** Configuración guardada de la empresa de la sesión, para mostrar en el panel. Sin secretos. */
export async function getErpConfigView(companyId: string): Promise<ErpConfigView> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("erp_company_settings")
    .select(VIEW_COLUMNS)
    .eq("company_id", companyId)
    .maybeSingle<SettingsRow>();
  if (error) throw new Error(`No se pudo leer la configuración del ERP (${error.code}).`, { cause: error });
  const provider = asProvider(data?.erp_provider ?? null);
  return {
    provider,
    baseUrl: data?.erp_base_url ?? null,
    odooDatabase: data?.erp_odoo_database ?? null,
    odooUsername: data?.erp_odoo_username ?? null,
    itemGroup: data?.erp_item_group ?? null,
    timeoutSeconds: data?.erp_timeout_ms ? Math.round(data.erp_timeout_ms / 1000) : null,
    mockScenario: data?.erp_mock_scenario ?? null,
    mockDispatchStatus: data?.erp_mock_dispatch_status ?? null,
    apiKeyHint: data?.erp_api_key_hint ?? null,
    apiSecretHint: data?.erp_api_secret_hint ?? null,
    configuredAt: data?.erp_configured_at ?? null,
    usesServerVariables: provider === "none" && usesEnvErp(companyId),
    allowMock: allowMockErp(),
  };
}

/**
 * ¿Se pueden reutilizar las credenciales guardadas? Solo si el proveedor y la URL no cambian: así nadie apunta la
 * URL a otro servidor para que TrazFlow le mande la credencial guardada (la base aplica la misma regla al guardar).
 */
export function canReuseStoredCredentials(input: ErpConfigFormInput, view: ErpConfigView): boolean {
  return input.provider !== null
    && input.provider === view.provider
    && comparableBaseUrl(input.baseUrl) === comparableBaseUrl(view.baseUrl);
}

/**
 * "Probar conexión" con lo que está en el formulario, sin guardar. Si faltan credenciales y se pueden reutilizar,
 * usa las guardadas (leídas con service_role y descartadas al terminar). Nunca lanza.
 */
export async function testErpConfig(params: {
  companyId: string;
  input: ErpConfigFormInput;
  view: ErpConfigView;
  readStored?: (companyId: string) => Promise<unknown>;
}): Promise<ErpHealthState> {
  const { input } = params;
  return checkErpHealth({
    getClient: async () => {
      let credentials: CompanyErpConnection["credentials"] = { apiKey: input.apiKey, apiSecret: input.apiSecret };
      const missing = !input.apiKey || (input.provider === "erpnext" && !input.apiSecret);
      if (input.provider !== "mock" && missing && canReuseStoredCredentials(input, params.view)) {
        const stored = await (params.readStored ?? readCompanyErpConnection)(params.companyId) as CompanyErpConnection | null;
        credentials = {
          apiKey: input.apiKey ?? stored?.credentials?.apiKey ?? null,
          apiSecret: input.apiSecret ?? stored?.credentials?.apiSecret ?? null,
        };
      }
      const config = parseCompanyErpConnection({ ...input, credentials });
      // Sin clave de caché: una prueba nunca reutiliza (ni ensucia) el mock de la empresa.
      return createErpClient(config);
    },
  });
}

/** Mensaje para el usuario según el error de erp_save_company_config. */
export function describeSaveError(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return "Solo logística puede configurar el ERP de la empresa.";
  if (error.code === "22023" && error.message) return error.message;
  if (error.code === "23514") return "Algún dato de la configuración no es válido. Revisá la URL y los campos de Odoo.";
  return "No se pudo guardar la configuración del ERP. Intentá nuevamente.";
}
