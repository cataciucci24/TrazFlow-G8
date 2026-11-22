import "server-only";

import { ErpError, isErpProvider, type ErpProvider } from "./types.ts";
import { isMockDispatchStatus, isMockScenario, type MockDispatchStatus, type MockScenario } from "./mock-scenarios.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

export type ErpConfig =
  | { provider: "mock"; mockScenario: MockScenario; mockDispatchStatus: MockDispatchStatus }
  | {
      provider: "erpnext";
      baseUrl: string;
      apiKey: string;
      apiSecret: string;
      timeoutMs: number;
      itemGroup?: string;
    }
  | {
      provider: "odoo";
      baseUrl: string;
      database: string;
      username: string;
      apiKey: string;
      timeoutMs: number;
    };

type Env = Record<string, string | undefined>;

/** Variables obligatorias de cada proveedor remoto, en el orden en que se informan si faltan. */
const REQUIRED_VARIABLES = {
  erpnext: ["ERP_BASE_URL", "ERP_API_KEY", "ERP_API_SECRET"],
  odoo: ["ERP_BASE_URL", "ERP_ODOO_DB", "ERP_ODOO_USER", "ERP_API_KEY"],
} as const;

/**
 * Lee y valida la configuración ERP desde variables de entorno del servidor. Ninguna lleva prefijo NEXT_PUBLIC_:
 * el proveedor y las credenciales no se pueden elegir ni leer desde el navegador.
 *
 * - ERP_PROVIDER: `mock` (por defecto) | `erpnext` | `odoo`.
 * - ERP_MOCK_SCENARIO: solo mock. `ok` (por defecto) | `timeout` | `unauthorized` | `validation` | `server_error`.
 * - ERP_MOCK_DISPATCH_STATUS: solo mock. Estado que informa getDispatchStatus: `confirmed` (por defecto) | `draft`.
 * - ERP_BASE_URL, ERP_API_KEY, ERP_API_SECRET: obligatorias con erpnext.
 * - ERP_BASE_URL, ERP_ODOO_DB, ERP_ODOO_USER, ERP_API_KEY: obligatorias con odoo (base, usuario y API key de Odoo).
 * - ERP_TIMEOUT_MS: opcional, 10000 por defecto.
 * - ERP_ITEM_GROUP: opcional, solo erpnext. Item Group de los productos que crea la importación (USH1); sin valor, el primero que no sea grupo.
 */
export function readErpConfig(env: Env = process.env): ErpConfig {
  const rawProvider = env.ERP_PROVIDER?.trim() || "mock";
  if (!isErpProvider(rawProvider)) {
    throw new ErpError("config", `ERP_PROVIDER inválido: "${rawProvider}". Valores posibles: mock, erpnext, odoo.`);
  }
  const provider: ErpProvider = rawProvider;

  if (provider === "mock") {
    const scenario = env.ERP_MOCK_SCENARIO?.trim() || "ok";
    if (!isMockScenario(scenario)) throw new ErpError("config", `ERP_MOCK_SCENARIO inválido: "${scenario}".`);
    const dispatchStatus = env.ERP_MOCK_DISPATCH_STATUS?.trim() || "confirmed";
    if (!isMockDispatchStatus(dispatchStatus)) {
      throw new ErpError("config", `ERP_MOCK_DISPATCH_STATUS inválido: "${dispatchStatus}". Valores posibles: confirmed, draft.`);
    }
    return { provider, mockScenario: scenario, mockDispatchStatus: dispatchStatus };
  }

  const { baseUrl, timeoutMs } = readRemoteConnection(env, REQUIRED_VARIABLES[provider]);

  if (provider === "odoo") {
    return {
      provider,
      baseUrl,
      database: env.ERP_ODOO_DB!.trim(),
      username: env.ERP_ODOO_USER!.trim(),
      apiKey: env.ERP_API_KEY!.trim(),
      timeoutMs,
    };
  }

  return {
    provider,
    baseUrl,
    apiKey: env.ERP_API_KEY!.trim(),
    apiSecret: env.ERP_API_SECRET!.trim(),
    timeoutMs,
    ...(env.ERP_ITEM_GROUP?.trim() ? { itemGroup: env.ERP_ITEM_GROUP.trim() } : {}),
  };
}

/** Validación común de los proveedores remotos: variables obligatorias, URL http(s) sin barra final y timeout. */
function readRemoteConnection(env: Env, required: readonly string[]): { baseUrl: string; timeoutMs: number } {
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new ErpError("config", `Faltan variables de entorno del ERP: ${missing.join(", ")}.`);

  let baseUrl: URL;
  try {
    baseUrl = new URL(env.ERP_BASE_URL!.trim());
  } catch {
    throw new ErpError("config", "ERP_BASE_URL no es una URL válida.");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new ErpError("config", "ERP_BASE_URL debe usar http o https.");
  }

  const rawTimeout = env.ERP_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ErpError("config", "ERP_TIMEOUT_MS debe ser un entero positivo en milisegundos.");
  }

  return { baseUrl: baseUrl.origin + baseUrl.pathname.replace(/\/+$/, ""), timeoutMs };
}
