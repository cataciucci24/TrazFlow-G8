import "server-only";

import type { ErpClient } from "./client.ts";
import { parseCompanyErpConnection, readErpConfig, type ErpConfig } from "./config.ts";
import { createErpClient } from "./factory.ts";
import { ErpError, type ErpProvider } from "./types.ts";

/**
 * ERP de cada empresa (TRZ-112). Es el único lugar que decide con qué ERP habla una empresa:
 *
 *   1. Configuración guardada desde el panel (erp_company_settings + credenciales en Vault). Si existe, gana.
 *   2. Si no hay configuración guardada y la empresa es la de ERP_ENV_COMPANY_ID, las variables ERP_* del servidor
 *      (transición: TrazFlow Demo sigue con su ERPNext hasta que logística la guarde en el panel).
 *   3. Si no, la empresa no tiene ERP (modo manual).
 *
 * Las variables ERP_* nunca se aplican a otra empresa: así dos empresas no comparten ERP por accidente.
 */

type Env = Record<string, string | undefined>;

/** De dónde salió la configuración. `env` = variables del servidor (transición, ver arriba). */
export type ErpConfigSource = "company" | "env";

export type CompanyErpConfig = { companyId: string; source: ErpConfigSource; config: ErpConfig };

/** Lo que necesita quien habla con el ERP de una empresa. */
export type ErpContext = {
  companyId: string;
  provider: ErpProvider;
  source: ErpConfigSource;
  client: ErpClient;
};

/**
 * Lecturas que necesita la resolución. `readConnection` usa service_role (erp_company_connection devuelve las
 * credenciales descifradas): solo existe en el servidor y nunca con la sesión del usuario.
 */
export type CompanyErpDeps = {
  readConnection: (companyId: string) => Promise<unknown>;
  env?: Env;
};

/** ¿Las variables ERP_* del servidor corresponden a esta empresa? */
export function usesEnvErp(companyId: string, env: Env = process.env): boolean {
  const target = env.ERP_ENV_COMPANY_ID?.trim();
  return Boolean(target && target === companyId && env.ERP_PROVIDER?.trim());
}

/** Configuración del ERP de la empresa, o null si trabaja sin ERP. Lanza ErpError si la guardada es inválida. */
export async function resolveCompanyErpConfig(companyId: string, deps: CompanyErpDeps): Promise<CompanyErpConfig | null> {
  if (!companyId) throw new ErpError("config", "Falta la empresa para elegir su ERP.");
  const env = deps.env ?? process.env;

  let stored: unknown;
  try {
    stored = await deps.readConnection(companyId);
  } catch (error) {
    if (error instanceof ErpError) throw error;
    // Falla pasajera de la base: reintentable, sin detalles (pueden traer datos de la conexión).
    throw new ErpError("unavailable", "No se pudo leer la configuración del ERP de la empresa.");
  }
  if (stored) return { companyId, source: "company", config: parseCompanyErpConnection(stored) };
  if (usesEnvErp(companyId, env)) return { companyId, source: "env", config: readErpConfig(env) };
  return null;
}

/** Contexto ERP de la empresa (proveedor + cliente), o null si trabaja sin ERP. */
export async function resolveCompanyErpContext(companyId: string, deps: CompanyErpDeps): Promise<ErpContext | null> {
  const resolved = await resolveCompanyErpConfig(companyId, deps);
  if (!resolved) return null;
  return {
    companyId,
    provider: resolved.config.provider,
    source: resolved.source,
    client: createErpClient(resolved.config, companyId),
  };
}
