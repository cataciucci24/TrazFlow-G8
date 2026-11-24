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

  const baseUrl = normalizeErpBaseUrl(env.ERP_BASE_URL!, "ERP_BASE_URL");

  const rawTimeout = env.ERP_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ErpError("config", "ERP_TIMEOUT_MS debe ser un entero positivo en milisegundos.");
  }

  return { baseUrl, timeoutMs };
}

/** URL http(s) del ERP, sin barra final. `label` es cómo se nombra el dato en el mensaje de error. */
export function normalizeErpBaseUrl(value: string, label = "La URL del ERP"): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ErpError("config", `${label} no es una URL válida.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ErpError("config", `${label} debe usar http o https.`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/* ---------- TRZ-112: configuración guardada por empresa ---------- */

/**
 * Conexión de una empresa tal como la guarda erp_company_settings + Vault (erp_company_connection en
 * 20261124100000_trz112_company_erp.sql). `credentials` viene descifrada: este objeto nunca sale del servidor.
 */
export type CompanyErpConnection = {
  provider: string | null;
  baseUrl?: string | null;
  odooDatabase?: string | null;
  odooUsername?: string | null;
  itemGroup?: string | null;
  timeoutMs?: number | null;
  mockScenario?: string | null;
  mockDispatchStatus?: string | null;
  credentials?: { apiKey?: string | null; apiSecret?: string | null } | null;
};

/** Límites del timeout configurable desde el panel (los mismos que el check de la base). */
export const ERP_TIMEOUT_MIN_MS = 1_000;
export const ERP_TIMEOUT_MAX_MS = 60_000;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Valida la conexión guardada de una empresa y la convierte en ErpConfig. Mensajes en términos del panel (no de
 * variables de entorno). Lanza ErpError("config") si falta algo o es inválido.
 */
export function parseCompanyErpConnection(raw: unknown): ErpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ErpError("config", "La configuración del ERP de la empresa no es válida.");
  }
  const connection = raw as CompanyErpConnection;
  const provider = text(connection.provider);
  if (!provider || !isErpProvider(provider)) {
    throw new ErpError("config", "La empresa no tiene un proveedor de ERP válido.");
  }

  if (provider === "mock") {
    const scenario = text(connection.mockScenario) ?? "ok";
    if (!isMockScenario(scenario)) throw new ErpError("config", `Escenario del mock inválido: "${scenario}".`);
    const dispatchStatus = text(connection.mockDispatchStatus) ?? "confirmed";
    if (!isMockDispatchStatus(dispatchStatus)) {
      throw new ErpError("config", `Estado del remito del mock inválido: "${dispatchStatus}".`);
    }
    return { provider, mockScenario: scenario, mockDispatchStatus: dispatchStatus };
  }

  const rawUrl = text(connection.baseUrl);
  if (!rawUrl) throw new ErpError("config", "Falta la URL del ERP.");
  const baseUrl = normalizeErpBaseUrl(rawUrl);

  const timeoutMs = connection.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < ERP_TIMEOUT_MIN_MS || timeoutMs > ERP_TIMEOUT_MAX_MS) {
    throw new ErpError("config", `El timeout del ERP debe estar entre ${ERP_TIMEOUT_MIN_MS} y ${ERP_TIMEOUT_MAX_MS} ms.`);
  }

  const apiKey = text(connection.credentials?.apiKey);
  if (provider === "odoo") {
    const database = text(connection.odooDatabase);
    const username = text(connection.odooUsername);
    if (!database || !username) throw new ErpError("config", "Faltan la base de datos o el usuario de Odoo.");
    if (!apiKey) throw new ErpError("config", "Falta la API key del ERP.");
    return { provider, baseUrl, database, username, apiKey, timeoutMs };
  }

  const apiSecret = text(connection.credentials?.apiSecret);
  if (!apiKey || !apiSecret) throw new ErpError("config", "Faltan la API key o el API secret del ERP.");
  const itemGroup = text(connection.itemGroup);
  return { provider, baseUrl, apiKey, apiSecret, timeoutMs, ...(itemGroup ? { itemGroup } : {}) };
}
