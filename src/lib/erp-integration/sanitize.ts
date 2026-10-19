/**
 * Sanitización de mensajes de error del ERP antes de mostrarlos. Los mensajes ya se guardan sanitizados
 * (ErpError), pero se vuelven a limpiar en el servidor por si un proveedor o una versión anterior dejó algo
 * de más: URLs (pueden ser privadas), credenciales, tokens largos y correos.
 */

const MAX_LENGTH = 300;

const PATTERNS: [RegExp, string][] = [
  // URLs con esquema (http, https, ftp...), incluidas las privadas.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[url oculta]"],
  // Encabezados y esquemas de autenticación: "Authorization: token key:secret", "Bearer xyz".
  [/\b(authorization|bearer|token|basic)\b(\s*[:=]\s*|\s+)[^\s,;]+(\s+[^\s,;:]+:[^\s,;]+)?/gi, "$1 [oculto]"],
  // Pares clave=valor con nombres sensibles.
  [/\b(api[_-]?key|api[_-]?secret|secret|password|passwd|pwd|access[_-]?token|refresh[_-]?token|session|cookie|sid)\b\s*[:=]\s*[^\s,;&]+/gi, "$1=[oculto]"],
  // Correos.
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "[correo oculto]"],
  // Secuencias largas sin espacios que parecen tokens (los UUID tienen guiones y no entran).
  [/\b[A-Za-z0-9_+/=]{32,}\b/g, "[oculto]"],
];

export function sanitizeErpErrorText(value: unknown, maxLength = MAX_LENGTH): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
