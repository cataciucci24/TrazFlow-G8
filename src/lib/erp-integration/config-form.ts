import "server-only";

import { ERP_PROVIDERS, type ErpProvider } from "../erp/types.ts";
import { isMockDispatchStatus, isMockScenario } from "../erp/mock-scenarios.ts";

/**
 * Formulario "Configuración del ERP" del panel de integración (TRZ-112). Validación sin entorno ni red: la usan
 * las acciones de guardar y de probar conexión. Las credenciales llegan en texto (inputs de contraseña) y nunca
 * se devuelven al navegador: si quedan vacías, se conservan las guardadas (lo decide la base).
 */

export type ErpConfigFormInput = {
  provider: ErpProvider | null;
  baseUrl: string | null;
  odooDatabase: string | null;
  odooUsername: string | null;
  itemGroup: string | null;
  timeoutMs: number | null;
  mockScenario: string | null;
  mockDispatchStatus: string | null;
  apiKey: string | null;
  apiSecret: string | null;
};

export type ErpConfigFormResult =
  | { ok: true; input: ErpConfigFormInput }
  | { ok: false; errors: string[] };

const MAX_TEXT = 500;
const TIMEOUT_MIN_S = 1;
const TIMEOUT_MAX_S = 60;

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Valida el formulario. `allowMock`: el ERP simulado solo se ofrece fuera de producción. */
export function parseErpConfigForm(formData: FormData, options: { allowMock: boolean }): ErpConfigFormResult {
  const errors: string[] = [];
  const rawProvider = field(formData, "provider");
  const provider = rawProvider === null || rawProvider === "none"
    ? null
    : (ERP_PROVIDERS as readonly string[]).includes(rawProvider) ? rawProvider as ErpProvider : undefined;
  if (provider === undefined) return { ok: false, errors: ["Elegí un proveedor de ERP válido."] };
  if (provider === "mock" && !options.allowMock) return { ok: false, errors: ["El ERP simulado no está disponible en producción."] };

  const empty: ErpConfigFormInput = {
    provider, baseUrl: null, odooDatabase: null, odooUsername: null, itemGroup: null, timeoutMs: null,
    mockScenario: null, mockDispatchStatus: null, apiKey: null, apiSecret: null,
  };
  if (provider === null) return { ok: true, input: empty };

  for (const name of ["baseUrl", "odooDatabase", "odooUsername", "itemGroup", "apiKey", "apiSecret"]) {
    if ((field(formData, name)?.length ?? 0) > MAX_TEXT) errors.push("Algún dato supera los 500 caracteres.");
  }

  if (provider === "mock") {
    const mockScenario = field(formData, "mockScenario") ?? "ok";
    const mockDispatchStatus = field(formData, "mockDispatchStatus") ?? "confirmed";
    if (!isMockScenario(mockScenario)) errors.push("Elegí un escenario del ERP simulado válido.");
    if (!isMockDispatchStatus(mockDispatchStatus)) errors.push("Elegí un estado de remito simulado válido.");
    return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, input: { ...empty, mockScenario, mockDispatchStatus } };
  }

  const baseUrl = field(formData, "baseUrl");
  if (!baseUrl) {
    errors.push("Ingresá la URL del ERP.");
  } else {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") errors.push("La URL del ERP debe empezar con http:// o https://.");
    } catch {
      errors.push("La URL del ERP no es válida.");
    }
  }

  const rawTimeout = field(formData, "timeoutSeconds");
  let timeoutMs: number | null = null;
  if (rawTimeout) {
    const seconds = Number(rawTimeout);
    if (!Number.isInteger(seconds) || seconds < TIMEOUT_MIN_S || seconds > TIMEOUT_MAX_S) {
      errors.push(`El tiempo de espera debe ser un número entero entre ${TIMEOUT_MIN_S} y ${TIMEOUT_MAX_S} segundos.`);
    } else {
      timeoutMs = seconds * 1000;
    }
  }

  const odooDatabase = provider === "odoo" ? field(formData, "odooDatabase") : null;
  const odooUsername = provider === "odoo" ? field(formData, "odooUsername") : null;
  if (provider === "odoo" && (!odooDatabase || !odooUsername)) errors.push("Ingresá la base de datos y el usuario de Odoo.");

  const input: ErpConfigFormInput = {
    ...empty,
    baseUrl,
    timeoutMs,
    odooDatabase,
    odooUsername,
    itemGroup: provider === "erpnext" ? field(formData, "itemGroup") : null,
    apiKey: field(formData, "apiKey"),
    apiSecret: provider === "erpnext" ? field(formData, "apiSecret") : null,
  };
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, input };
}

/** Normaliza la URL como la guarda la base (sin barra final), para comparar con la guardada. */
export function comparableBaseUrl(value: string | null): string | null {
  return value ? value.trim().replace(/\/+$/, "") : null;
}
