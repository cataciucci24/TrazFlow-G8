export type PlanChangeState = { error: string | null };
export const planChangeMessages: Record<string, string> = {
  confirmation_required: "Confirmá que revisaste el cambio y los avisos de consumo.",
  unassigned: "Tu empresa no tiene un plan asignado. La asignación inicial requiere gestión administrativa.",
  stale: "El plan asignado cambió desde que abriste el resumen. Volvé a comparar y revisá nuevamente.",
  invalid_plan: "El plan seleccionado ya no está disponible.",
  commercial_required: "Este plan requiere gestión comercial y no puede activarse automáticamente.",
  same_plan: "Este ya es el plan actual de tu empresa.",
};

export function parsePlanChange(form: FormData) {
  const target = form.get("targetCode"), expected = form.get("expectedCode");
  const assignedAt = form.get("assignedAt"), requestId = form.get("requestId");
  if (form.get("confirmed") !== "on" || typeof target !== "string" || !target.trim()
    || typeof expected !== "string" || !expected.trim() || typeof assignedAt !== "string"
    || !Number.isFinite(Date.parse(assignedAt)) || typeof requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return null;
  return { p_target_code: target, p_expected_code: expected, p_expected_assigned_at: assignedAt,
    p_request_id: requestId, p_confirmed: true };
}
