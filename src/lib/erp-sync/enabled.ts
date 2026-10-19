import "server-only";

/**
 * ¿La empresa trabaja con un ERP? Con ERP, productos, lotes y stock vienen de la sincronización y TrazFlow
 * oculta su alta manual. Hoy depende de que ERP_PROVIDER esté definido explícitamente en el servidor
 * (getErpClient usa `mock` por defecto, pero eso no cuenta como "configurado"). Es el único lugar que decide
 * esto: cuando haya un flag por empresa, se cambia acá.
 */
export async function isErpEnabled(
  companyId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  void companyId;
  return Boolean(env.ERP_PROVIDER?.trim());
}

/** Nombre del proveedor configurado, para auditar en erp_sync_runs. */
export function configuredErpProvider(env: Record<string, string | undefined> = process.env): string {
  return (env.ERP_PROVIDER?.trim() || "mock").slice(0, 40);
}
