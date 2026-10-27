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
    };

type Env = Record<string, string | undefined>;

/**
 * Lee y valida la configuración ERP desde variables de entorno del servidor. Ninguna lleva prefijo NEXT_PUBLIC_:
 * el proveedor y las credenciales no se pueden elegir ni leer desde el navegador.
 *
 * - ERP_PROVIDER: `mock` (por defecto) | `erpnext`.
 * - ERP_MOCK_SCENARIO: solo mock. `ok` (por defecto) | `timeout` | `unauthorized` | `validation` | `server_error`.
 * - ERP_MOCK_DISPATCH_STATUS: solo mock. Estado que informa getDispatchStatus: `confirmed` (por defecto) | `draft`.
 * - ERP_BASE_URL, ERP_API_KEY, ERP_API_SECRET: obligatorias con erpnext.
 * - ERP_TIMEOUT_MS: opcional, 10000 por defecto.
 */
export function readErpConfig(env: Env = process.env): ErpConfig {
  const rawProvider = env.ERP_PROVIDER?.trim() || "mock";
  if (!isErpProvider(rawProvider)) {
    throw new ErpError("config", `ERP_PROVIDER inválido: "${rawProvider}". Valores posibles: mock, erpnext.`);
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

  const missing = ["ERP_BASE_URL", "ERP_API_KEY", "ERP_API_SECRET"].filter((name) => !env[name]?.trim());
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

  return {
    provider,
    baseUrl: baseUrl.origin + baseUrl.pathname.replace(/\/+$/, ""),
    apiKey: env.ERP_API_KEY!.trim(),
    apiSecret: env.ERP_API_SECRET!.trim(),
    timeoutMs,
  };
}
