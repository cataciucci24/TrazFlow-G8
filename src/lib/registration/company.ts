// Alta de empresa (TRZ-112). Mantener los límites iguales a create_company_with_manager.
export const COMPANY_NAME_MIN_LENGTH = 2;
export const COMPANY_NAME_MAX_LENGTH = 140;

/** Cómo quiere entrar el usuario: sumarse a una empresa existente (US27) o dar de alta la suya. */
export type RegistrationMode = "join" | "new";

export function isRegistrationMode(value: unknown): value is RegistrationMode {
  return value === "join" || value === "new";
}

export function normalizeCompanyName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = Array.from(name).length;
  return length >= COMPANY_NAME_MIN_LENGTH && length <= COMPANY_NAME_MAX_LENGTH ? name : null;
}

/** Plan que se puede elegir en el alta: solo los de precio publicado (Starter y Growth). */
export type SignupPlan = {
  code: string;
  name: string;
  monthlyPriceCents: number;
  currency: string;
  maxOperators: number | null;
  maxPalletsPerMonth: number | null;
  preliminary: boolean;
};

export const companyErrorMessages = {
  "invalid-name": "Ingresá tu nombre completo.",
  "invalid-company-name": `Ingresá el nombre de la empresa (entre ${COMPANY_NAME_MIN_LENGTH} y ${COMPANY_NAME_MAX_LENGTH} caracteres).`,
  "invalid-cuit": "El CUIT no es válido. Revisá los 11 dígitos (podés escribirlo con o sin guiones).",
  "duplicate-cuit": "Ya hay una empresa registrada con ese CUIT. Pedí acceso a su responsable logístico eligiendo «Sumarme a una empresa».",
  "invalid-plan": "Elegí uno de los planes disponibles.",
  "email-unconfirmed": "Confirmá tu email antes de dar de alta la empresa.",
  "pending-request": "Tenés una solicitud de acceso pendiente. Esperá la respuesta antes de dar de alta otra empresa.",
  "company-failed": "No pudimos dar de alta la empresa. Tu cuenta sigue creada; podés volver a intentar.",
} as const;

export type CompanyError = keyof typeof companyErrorMessages;

export function isCompanyError(value: unknown): value is CompanyError {
  return typeof value === "string" && Object.hasOwn(companyErrorMessages, value);
}

/** Códigos de create_company_with_manager. P4104 (ya tiene perfil) no es un error: se va al dashboard. */
const rpcErrors: Record<string, CompanyError> = {
  P4101: "email-unconfirmed",
  P4102: "company-failed",
  P4103: "invalid-name",
  P4105: "pending-request",
  P4106: "invalid-company-name",
  P4107: "invalid-cuit",
  P4108: "duplicate-cuit",
  P4109: "invalid-plan",
};

export function companyErrorFromRpc(code: string | undefined): CompanyError {
  return (code && rpcErrors[code]) || "company-failed";
}
