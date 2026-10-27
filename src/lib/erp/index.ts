import "server-only";

import type { ErpClient } from "./client.ts";
import { readErpConfig, type ErpConfig } from "./config.ts";
import { ErpNextClient } from "./erpnext-client.ts";
import { MockErpClient } from "./mock-client.ts";

export type { ErpClient } from "./client.ts";
export * from "./types.ts";

/**
 * El mock guarda en memoria los reportes recibidos; se reutiliza una instancia por escenario (y estado de remito)
 * para que los duplicados se detecten entre requests del mismo proceso.
 */
const mockClients = new Map<string, MockErpClient>();

export function createErpClient(config: ErpConfig): ErpClient {
  switch (config.provider) {
    case "mock": {
      const key = `${config.mockScenario}:${config.mockDispatchStatus}`;
      let client = mockClients.get(key);
      if (!client) {
        client = new MockErpClient({ scenario: config.mockScenario, dispatchStatus: config.mockDispatchStatus });
        mockClients.set(key, client);
      }
      return client;
    }
    case "erpnext":
      return new ErpNextClient(config);
  }
}

/**
 * Cliente ERP de una empresa, elegido por ERP_PROVIDER (`mock` por defecto). Hoy la configuración es global;
 * `companyId` queda en la firma para pasar a configuración por empresa sin cambiar a quienes la llaman.
 */
export function getErpClient(companyId?: string, env: Record<string, string | undefined> = process.env): ErpClient {
  void companyId;
  return createErpClient(readErpConfig(env));
}
