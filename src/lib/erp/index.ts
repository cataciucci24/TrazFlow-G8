import "server-only";

import { createServiceClient } from "../supabase/service.ts";
import type { ErpClient } from "./client.ts";
import { resolveCompanyErpContext, type CompanyErpDeps, type ErpContext } from "./company.ts";
import { ErpError } from "./types.ts";

export type { ErpClient } from "./client.ts";
export type { ErpContext, ErpConfigSource } from "./company.ts";
export { createErpClient } from "./factory.ts";
export * from "./types.ts";

/**
 * Lee la conexión guardada de la empresa con service_role (erp_company_connection). Las credenciales descifradas
 * quedan en memoria del servidor solo mientras se arma el cliente.
 */
export async function readCompanyErpConnection(companyId: string): Promise<unknown> {
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    throw new ErpError("config", "El servidor no tiene acceso a la configuración del ERP de las empresas.");
  }
  const { data, error } = await supabase.rpc("erp_company_connection", { p_company_id: companyId });
  if (error) throw new ErpError("unavailable", "No se pudo leer la configuración del ERP de la empresa.");
  return data;
}

const defaultDeps: CompanyErpDeps = { readConnection: readCompanyErpConnection };

/**
 * ERP de una empresa (TRZ-112): proveedor y cliente, o null si la empresa trabaja sin ERP. El `companyId` tiene
 * que salir del perfil de la sesión o de la columna company_id del evento: nunca de un dato que mande el usuario.
 */
export function getCompanyErpContext(companyId: string, deps: CompanyErpDeps = defaultDeps): Promise<ErpContext | null> {
  return resolveCompanyErpContext(companyId, deps);
}

/** Cliente del ERP de la empresa. Si la empresa no tiene ERP, ErpError("config"). */
export async function getErpClient(companyId: string, deps: CompanyErpDeps = defaultDeps): Promise<ErpClient> {
  const context = await resolveCompanyErpContext(companyId, deps);
  if (!context) throw new ErpError("config", "La empresa no tiene un ERP configurado.");
  return context.client;
}
