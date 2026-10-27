/** Fallas que el mock ERP puede simular. `ok` = responde normalmente. */
export const MOCK_SCENARIOS = ["ok", "timeout", "unauthorized", "validation", "server_error"] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: string): value is MockScenario {
  return MOCK_SCENARIOS.some((scenario) => scenario === value);
}

/**
 * Cómo responde el mock a getDispatchStatus (ERP_MOCK_DISPATCH_STATUS). `confirmed` (por defecto) simula que
 * administración confirma el remito enseguida; `draft` deja ver la etiqueta "Esperando remito" en local.
 */
export const MOCK_DISPATCH_STATUSES = ["confirmed", "draft"] as const;

export type MockDispatchStatus = (typeof MOCK_DISPATCH_STATUSES)[number];

export function isMockDispatchStatus(value: string): value is MockDispatchStatus {
  return MOCK_DISPATCH_STATUSES.some((status) => status === value);
}
