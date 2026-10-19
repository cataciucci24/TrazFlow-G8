import "server-only";

import type { ErpClient } from "../erp/client.ts";
import { ErpError, isErpError } from "../erp/types.ts";
import { sanitizeErpErrorText } from "./sanitize.ts";
import type { ErpHealthState } from "./types.ts";

export const HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * Verifica la conexión con ErpClient.healthcheck(), con un timeout propio para que un ERP lento no trabe
 * el panel. Nunca lanza. Solo devuelve proveedor y latencia, o el código y el mensaje sanitizado del error.
 */
export async function checkErpHealth(params: {
  getClient: () => ErpClient;
  timeoutMs?: number;
  now?: () => Date;
}): Promise<ErpHealthState> {
  const timeoutMs = params.timeoutMs ?? HEALTHCHECK_TIMEOUT_MS;
  const now = params.now ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = params.getClient();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ErpError("timeout", `El ERP no respondió al control de conexión en ${Math.round(timeoutMs / 1000)} s.`)),
        timeoutMs,
      );
    });
    const health = await Promise.race([client.healthcheck(), timeout]);
    return { status: "ok", provider: health.provider, latencyMs: health.latencyMs, checkedAt: health.checkedAt };
  } catch (error) {
    return {
      status: "error",
      code: isErpError(error) ? error.code : "unknown",
      message: (isErpError(error) && sanitizeErpErrorText(error.message)) || "No se pudo verificar la conexión con el ERP.",
      checkedAt: now().toISOString(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
