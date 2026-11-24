import "server-only";

import type { ErpClient } from "./client.ts";
import type { ErpConfig } from "./config.ts";
import { ErpNextClient } from "./erpnext-client.ts";
import { MockErpClient } from "./mock-client.ts";
import { OdooClient } from "./odoo-client.ts";

/**
 * El mock guarda en memoria los reportes recibidos; se reutiliza una instancia por empresa, escenario y estado de
 * remito para que los duplicados se detecten entre requests del mismo proceso. La empresa va en la clave (TRZ-112):
 * dos empresas con el mock no comparten reportes.
 */
const mockClients = new Map<string, MockErpClient>();

/**
 * Arma el adaptador de una configuración ya validada. `cacheKey` identifica a la empresa dueña de la
 * configuración (solo se usa con el mock); sin clave, el mock es una instancia nueva (p. ej. "Probar conexión").
 */
export function createErpClient(config: ErpConfig, cacheKey?: string): ErpClient {
  switch (config.provider) {
    case "mock": {
      if (cacheKey === undefined) {
        return new MockErpClient({ scenario: config.mockScenario, dispatchStatus: config.mockDispatchStatus });
      }
      const key = `${cacheKey}:${config.mockScenario}:${config.mockDispatchStatus}`;
      let client = mockClients.get(key);
      if (!client) {
        client = new MockErpClient({ scenario: config.mockScenario, dispatchStatus: config.mockDispatchStatus });
        mockClients.set(key, client);
      }
      return client;
    }
    case "erpnext":
      return new ErpNextClient(config);
    case "odoo":
      return new OdooClient(config);
  }
}
