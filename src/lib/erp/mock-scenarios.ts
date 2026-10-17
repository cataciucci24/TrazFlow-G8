/** Fallas que el mock ERP puede simular. `ok` = responde normalmente. */
export const MOCK_SCENARIOS = ["ok", "timeout", "unauthorized", "validation", "server_error"] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: string): value is MockScenario {
  return MOCK_SCENARIOS.some((scenario) => scenario === value);
}
