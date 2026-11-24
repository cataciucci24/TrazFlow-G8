import "server-only";

import { cache } from "react";

import { usesEnvErp } from "@/lib/erp/company";
import { createClient } from "@/lib/supabase/server";

/**
 * Lee el proveedor guardado de una empresa (erp_company_provider: sin secretos). null = sin configuración guardada.
 * Con la sesión del usuario solo puede leer el de su empresa; el cron pasa uno con service_role.
 */
export type ErpProviderReader = (companyId: string) => Promise<string | null>;

/** Lector con la sesión del request. Se memoriza por request: varias pantallas lo consultan en el mismo render. */
const sessionProviderReader: ErpProviderReader = cache(async (companyId: string) => {
  const supabase = await createClient();
  return readProvider(supabase, companyId);
});

/** Lector de erp_company_provider con el cliente de Supabase que se le pase (sesión o service_role). */
export async function readProvider(
  db: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> },
  companyId: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("erp_company_provider", { p_company_id: companyId });
  if (error) throw new Error(`No se pudo leer el ERP de la empresa (${error.code ?? "sin código"}).`);
  return typeof data === "string" && data ? data : null;
}

/**
 * ¿La empresa trabaja con un ERP? (TRZ-112: por empresa). Con ERP, productos, lotes y stock vienen de la
 * sincronización y TrazFlow oculta su alta manual. Es el único lugar que decide esto:
 *   - ERP guardado desde el panel → sí.
 *   - Sin ERP guardado, pero es la empresa de ERP_ENV_COMPANY_ID con ERP_PROVIDER definido → sí (transición).
 *   - Si no → modo manual.
 * Misma precedencia que getCompanyErpContext (src/lib/erp/company.ts).
 */
export async function isErpEnabled(
  companyId: string,
  read: ErpProviderReader = sessionProviderReader,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!companyId) return false;
  if (await read(companyId)) return true;
  return usesEnvErp(companyId, env);
}
