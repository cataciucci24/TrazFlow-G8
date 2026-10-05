/** Hide database diagnostics only for the known action messages that include them.
 * Business messages (including useful parenthetical explanations) stay intact. */
const ACTION_FAILURE_PREFIXES = [
  "No se pudo crear la orden",
  "No se pudo guardar el stock",
  "No se pudo leer la orden",
  "No se pudieron reservar los pallets",
  "No se pudo asociar los pallets a la orden",
  "Los pallets se asociaron, pero no se pudo registrar el evento de trazabilidad",
];

export function actionErrorMessage(message: string) {
  const prefix = ACTION_FAILURE_PREFIXES.find((value) => message.startsWith(`${value} (`));
  if (prefix?.startsWith("Los pallets se asociaron")) return `${prefix}. Revisá el estado de la orden antes de volver a intentar.`;
  return prefix ? `${prefix}. Intentá nuevamente.` : message;
}

export function registrationErrorMessage(message: string) {
  if (message === "Datos inválidos" || message === "No se pudo enviar la solicitud") return message;
  if (/already registered|already exists/i.test(message)) return "Ya existe una cuenta con ese email. Intentá ingresar.";
  if (/rate limit|too many/i.test(message)) return "Se enviaron varias solicitudes. Esperá unos minutos antes de volver a intentar.";
  return "No se pudo crear la cuenta. Revisá los datos e intentá nuevamente.";
}
